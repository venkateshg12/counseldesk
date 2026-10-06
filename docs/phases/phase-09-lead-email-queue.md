# Phase 09 — Lead notification email through BullMQ

## 1. Goal

When a lead is captured (Phase 18), staff get an email: who, how to reach them, what kind of case,
and a link to the conversation. Sending happens in a background worker, not in the chat request.

This copies e-commerce's queue structure — queue, producer, processor, worker, shared Redis
connection, opt-in Bull Board — with one queue (`notify-queue`) and one job (`new_lead`). The lead
table gets a `notifiedAt` column so a retried job doesn't email twice in the common case.

This phase is built now and **used** in Phase 18, which calls the producer after saving a lead. Here
you verify it end to end by inserting a lead by hand and enqueueing a job with a small script.

## 2. What I will understand after this phase

1. Why slow, failure-prone work (email) is moved out of the request.
2. BullMQ's moving parts: queue, producer, worker, processor, and where retries and backoff live.
3. "At-least-once" delivery and how to make a processor safe to run twice.
4. Why a malformed job should fail permanently instead of retrying.
5. How a worker runs inside the API process or as its own process with the same code.

## 3. Prerequisites

- Phase 08 done (Redis connection exists).
- A Resend account and API key, and a verified sender address. Without a key, mail is printed to the
  terminal instead (the copied `sendMail` does this), which is enough to verify the phase.

## 4. Files

Sources are under `e-commerce/apps/backends/mongo/src/`.

```
apps/api/
├── src/prisma/contract.prisma               (Lead.notifiedAt)
├── src/constants/env.ts                     (Resend, staff email, Bull Board)
├── src/constants/queue.ts                   ADAPT constants/queue.ts
├── src/jobs/interfaces/jobPayload.ts        ADAPT jobs/interfaces/jobPayload.ts
├── src/jobs/queues/notify.queue.ts          ADAPT jobs/queues/email.queue.ts
├── src/jobs/producers/notify.producer.ts    ADAPT jobs/producers/email.producer.ts
├── src/jobs/processors/notify.processor.ts  ADAPT jobs/processors/email.processor.ts
├── src/jobs/workers/notify.worker.ts        ADAPT jobs/workers/email.worker.ts
├── src/jobs/dashboard/bull-board.ts         ADAPT jobs/dashboard/bull-board.ts
├── src/utils/email/sendMail.ts              COPY  utils/email/sendMail.ts
├── src/utils/email/leadEmail.ts             NEW
├── src/utils/email/index.ts                 NEW
├── src/worker.ts                            ADAPT worker.ts (ESM entry check)
├── src/scripts/enqueue-test-lead.ts         NEW   (verification only)
├── src/app.ts                               (Bull Board, opt-in)
└── src/index.ts                             (import worker, close it on shutdown)
```

## 5. Concepts

**Why a queue.** Email providers are slow (hundreds of milliseconds) and sometimes down. If the chat
request sent the email itself, a Resend outage would make lead capture fail for the visitor — the
most valuable moment in the product. Enqueuing is a fast Redis write; a worker sends the email
afterwards and retries on failure. The visitor never waits for, or sees, the email.

**The parts.** A _queue_ is a named list in Redis. A _producer_ adds a job (a name and a JSON
payload). A _worker_ takes jobs off the queue and calls a _processor_ function. Retries, backoff,
and how long finished jobs are kept are set on the queue's `defaultJobOptions`.

**Exponential backoff.** After a failure, wait 3 s, then 6 s, 12 s, 24 s… before the next attempt.
A provider that's briefly down gets time to recover instead of being hammered.

**At-least-once.** A job can run more than once: the worker can crash after sending the email but
before marking the job done, and BullMQ will run it again. So the processor checks `lead.notifiedAt`
first and sets it after sending. That makes a repeat a no-op in every case except the narrow window
"sent, then crashed before the update" — a duplicate email is the accepted cost; a lost one isn't.

**Deduplication by job id.** The producer uses `jobId: lead:<id>`. Adding a job with an id that
already exists does nothing, so calling the producer twice for one lead queues one job.

**Unrecoverable errors.** A payload that fails validation will fail identically on every retry.
Throwing BullMQ's `UnrecoverableError` skips the remaining attempts. A missing lead (deleted
conversation) is "nothing to do", returned as `skipped`, not an error.

**Errors must be thrown.** The copied `sendMail` _returns_ `{ error }` instead of throwing. If the
processor ignored that, a failed send would count as success and never be retried. The processor
checks `error` and throws.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter api add bullmq@^5.81.5 @bull-board/api@^8.6.1 @bull-board/express@^8.6.1 resend@^4.8.0
```

All on the majors e-commerce's code targets (bullmq 6, bull-board 9 and resend 6 exist).

### Step 2 — `Lead.notifiedAt`

In `contract.prisma`, add to `Lead`:

```prisma
    // Set by the notify worker after the staff email is sent; a retried job checks it first.
    notifiedAt     TimestamptzString?
```

```bash
cd apps/api && pnpm db:plan add_lead_notified_at && pnpm db:sql && pnpm db:migrate
```

A nullable column added to an existing table: the generated SQL is a plain `ALTER TABLE … ADD
COLUMN`, safe on a table with rows.

### Step 3 — Env

```ts
export const RESEND_API_KEY = getEnv("RESEND_API_KEY", "");
export const EMAIL_FROM = getEnv("EMAIL_FROM", "onboarding@resend.dev");
export const STAFF_NOTIFY_EMAIL = getEnv("STAFF_NOTIFY_EMAIL");
// Where staff open a conversation (Phase 36). Defaults to the first allowed origin.
export const STAFF_APP_URL = getEnv(
  "STAFF_APP_URL",
  CORS_ORIGIN.split(",")[0]!.trim(),
);
export const ENABLE_QUEUE_DASHBOARD = getEnv("ENABLE_QUEUE_DASHBOARD", "false");
export const QUEUE_DASHBOARD_USER = getEnv("QUEUE_DASHBOARD_USER", "");
export const QUEUE_DASHBOARD_PASSWORD = getEnv("QUEUE_DASHBOARD_PASSWORD", "");
```

`RESEND_API_KEY` defaults to empty on purpose: `sendMail` prints instead of sending when it's empty,
so local development needs no account. Add `STAFF_APP_URL=http://localhost:3000` to `.env.example`.

### Step 4 — Queue constants and payload

`src/constants/queue.ts`:

```ts
export const QUEUE_NAMES = {
  NOTIFY: "notify-queue",
} as const;

export const JOB_NAMES = {
  NOTIFY: {
    NEW_LEAD: "new_lead",
  },
} as const;
```

`src/jobs/interfaces/jobPayload.ts`:

```ts
// Only the id: the processor reads the current lead from the database, so the job never carries
// personal data into Redis or Bull Board.
export interface NewLeadPayload {
  leadId: string;
}
```

e-commerce's email payloads carried the email address and token. Carrying only an id is better here:
lead data is personal, and Bull Board shows payloads.

### Step 5 — Queue and producer

`src/jobs/queues/notify.queue.ts` — ADAPT `email.queue.ts` (same options):

```ts
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../../constants/queue.js";
import { redisConnection } from "../redis/connection.js";

export const notifyQueue = new Queue(QUEUE_NAMES.NOTIFY, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});
```

`src/jobs/producers/notify.producer.ts` — ADAPT the producer pattern, as a plain function rather than
a class of static methods (one method doesn't need a class):

```ts
import { JOB_NAMES } from "../../constants/queue.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";
import { notifyQueue } from "../queues/notify.queue.js";

export const enqueueNewLeadEmail = (payload: NewLeadPayload) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.NEW_LEAD, payload, {
    // Deduplicates: a second call for the same lead queues nothing.
    jobId: `lead:${payload.leadId}`,
  });
```

### Step 6 — Email content

`src/utils/email/sendMail.ts` — COPY. Changes: `.js` import from `../../constants/env.js`, and
`console.*` → `logger.*`.

`src/utils/email/leadEmail.ts`:

```ts
import { STAFF_APP_URL } from "../../constants/env.js";

type LeadEmailInput = {
  conversationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
};

// Visitor-provided text goes into HTML, so it is escaped. A name like "<script>" must stay text.
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const getNewLeadEmail = (lead: LeadEmailInput) => {
  const link = `${STAFF_APP_URL}/staff/conversations/${lead.conversationId}`;
  const lines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email ?? "—"}`,
    `Phone: ${lead.phone ?? "—"}`,
    `Case type: ${lead.caseType}`,
    `Summary: ${lead.summary ?? "—"}`,
  ];

  return {
    subject: `New lead: ${lead.name} (${lead.caseType})`,
    text: `${lines.join("\n")}\n\nOpen the conversation: ${link}`,
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p><p><a href="${link}">Open the conversation</a></p>`,
  };
};
```

`src/utils/email/index.ts`:

```ts
export * from "./sendMail.js";
export * from "./leadEmail.js";
```

### Step 7 — Processor and worker

`src/jobs/processors/notify.processor.ts` — ADAPT the email processor's shape: validate the payload
with Zod, throw `UnrecoverableError` on a malformed one, check the database before acting.

```ts
import { type Job, UnrecoverableError } from "bullmq";
import { z } from "zod";
import { orm } from "../../prisma/db.js";
import { STAFF_NOTIFY_EMAIL } from "../../constants/env.js";
import { getNewLeadEmail, sendMail } from "../../utils/email/index.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";

const payloadSchema = z.object({ leadId: z.uuid() });

export async function processNewLead(job: Job<NewLeadPayload>) {
  const parsed = payloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      `Malformed job payload: ${parsed.error.message}`,
    );
  }

  const lead = await orm.Lead.where({ id: parsed.data.leadId }).first();
  if (!lead) {
    return { status: "skipped", reason: "lead not found" };
  }
  // Idempotency: a retried or duplicated job after a successful send does nothing.
  if (lead.notifiedAt) {
    return { status: "skipped", reason: "already notified" };
  }

  const email = getNewLeadEmail(lead);
  const { error } = await sendMail({ to: STAFF_NOTIFY_EMAIL, ...email });
  // sendMail returns errors instead of throwing; throwing here is what makes BullMQ retry.
  if (error) {
    throw new Error(
      `Lead email failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await orm.Lead.where({ id: lead.id }).update({
    notifiedAt: new Date().toISOString(),
  });
  return { status: "sent" };
}
```

`job.log(...)` calls from the e-commerce processor are left out: they write the email address into
Redis, where Bull Board shows it.

`src/jobs/workers/notify.worker.ts` — ADAPT `email.worker.ts`: one job name, `concurrency: 2`, the
same 2-per-second `limiter` (polite to the email provider), the same event listeners with `logger`
instead of `console`:

```ts
import { type Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue.js";
import { processNewLead } from "../processors/notify.processor.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";
import { redisConnection } from "../redis/connection.js";
import { logger } from "../../utils/logger.js";

export const notifyWorker = new Worker(
  QUEUE_NAMES.NOTIFY,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.NOTIFY.NEW_LEAD:
        return processNewLead(job as Job<NewLeadPayload>);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 30000,
    limiter: { max: 2, duration: 1000 },
  },
);

notifyWorker.on("completed", (job, result) =>
  logger.info("job completed", { jobId: job.id, jobName: job.name, result }),
);
notifyWorker.on("failed", (job, error) =>
  logger.error("job failed", {
    jobId: job?.id,
    jobName: job?.name,
    attempt: job?.attemptsMade,
    error,
  }),
);
notifyWorker.on("stalled", (jobId) => logger.warn("job stalled", { jobId }));
notifyWorker.on("error", (error) =>
  logger.error("worker connection error", { error }),
);
```

### Step 8 — `worker.ts` (ESM)

ADAPT e-commerce's. The CommonJS check `require.main === module` doesn't exist in ES modules; the ESM
equivalent compares this file's URL with the script Node was started with.

```ts
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { notifyWorker } from "./jobs/workers/notify.worker.js";
import { connectDB, closeDB } from "./config/db.js";
import { redisConnection } from "./jobs/redis/connection.js";
import { logger } from "./utils/logger.js";

/** Stops the workers taking new jobs and waits for the ones in flight. */
export const closeWorkers = async () => {
  await notifyWorker.close();
};

/*
  Imported by index.ts so one process serves requests and runs jobs; also runnable on its own
  (`pnpm --filter api worker`). Only the standalone process connects the database and owns the
  signal handlers — when imported, index.ts drives shutdown and calls closeWorkers().
 */
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  await connectDB();
  logger.info("worker process started");

  const shutdown = async (signal: string) => {
    logger.info("worker shutdown started", { signal });
    await closeWorkers();
    await closeDB();
    await redisConnection.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
```

`package.json`:

```json
"worker": "tsx watch src/worker.ts"
```

In `index.ts`: `import { closeWorkers } from "./worker.js";` and in shutdown, after the server has
closed and **before** `closeDB()`: `await closeWorkers();` (a running job may still need the
database).

### Step 9 — Bull Board, opt-in

Copy `queueDashboardAuth` and `matchesSecret` from the top of `e-commerce/apps/backends/mongo/src/index.ts`
into `app.ts` (comments included), and the opt-in block from mongo's `main()`, adapted to one queue.
`jobs/dashboard/bull-board.ts` becomes:

```ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { notifyQueue } from "../queues/notify.queue.js";

export function setupBullBoard() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(notifyQueue)], serverAdapter });
  return serverAdapter.getRouter();
}
```

In `createApp()`, right after `const app = express()`:

```ts
const queueDashboardEnabled = ENABLE_QUEUE_DASHBOARD === "true";
if (
  queueDashboardEnabled &&
  !(QUEUE_DASHBOARD_USER && QUEUE_DASHBOARD_PASSWORD)
) {
  throw new Error(
    "ENABLE_QUEUE_DASHBOARD is true but QUEUE_DASHBOARD_USER/QUEUE_DASHBOARD_PASSWORD are not set",
  );
}
if (queueDashboardEnabled) {
  app.use("/admin/queues", queueDashboardAuth, setupBullBoard());
}
```

### Step 10 — Verification script

`src/scripts/enqueue-test-lead.ts`:

```ts
import "dotenv/config";
import { orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { enqueueNewLeadEmail } from "../jobs/producers/notify.producer.js";
import { notifyQueue } from "../jobs/queues/notify.queue.js";
import { redisConnection } from "../jobs/redis/connection.js";

// Creates a throwaway conversation + lead and queues its email. Delete once Phase 18 exists.
const conversation = await orm.Conversation.create({
  visitorId: "test-script",
});
const lead = await orm.Lead.create({
  conversationId: conversation.id,
  name: "Test Visitor",
  phone: "555-0100",
  caseType: "dui",
  summary: "Pulled over last night in Phoenix.",
});

await enqueueNewLeadEmail({ leadId: lead.id });
await enqueueNewLeadEmail({ leadId: lead.id }); // deduplicated by jobId
console.log(`Queued email for lead ${lead.id}`);

await notifyQueue.close();
await redisConnection.quit();
await closeDB();
```

## 7. Commit points

1. `feat(db): add notifiedAt to lead`
2. `feat(api): add notify queue, producer and lead email`
3. `feat(api): add idempotent lead email processor and worker`
4. `feat(api): run worker in-process or standalone, close it on shutdown`
5. `feat(api): add opt-in bull board for the notify queue`

## 8. Verify

```bash
pnpm --filter api dev                                   # API + worker in one process
pnpm --filter api exec tsx src/scripts/enqueue-test-lead.ts
# API terminal (no RESEND_API_KEY): the email printed by sendMail, then
# INFO job completed {"jobId":"lead:…","jobName":"new_lead","result":{"status":"sent"}}

# Only one job despite two enqueue calls
docker exec counseldesk-redis redis-cli keys 'bull:notify-queue:lead:*'

# notifiedAt is set
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c 'SELECT name, "notifiedAt" FROM lead;'

# Durability: stop the API, run the script, start the API → the job runs on startup

# Retry: set RESEND_API_KEY=re_invalid, enqueue a new lead → "job failed" lines with attempt 1,2,…
# spaced further apart each time (3 s, 6 s, 12 s…)

# Standalone worker: stop the API, run `pnpm --filter api worker`, enqueue → the worker sends it

# Bull Board: ENABLE_QUEUE_DASHBOARD=true + user/password → http://localhost:4000/admin/queues asks
# for basic auth; the job's data shows only {"leadId": "…"}
```

## 9. Common mistakes

- **Ignoring `sendMail`'s returned error.** Failures look like successes and are never retried.
- **Putting the lead's email/phone in the job payload.** It sits in Redis for a week (`removeOnFail`)
  and shows in Bull Board.
- **Closing the database before the workers** on shutdown: an in-flight job fails mid-update.
- **Using `require.main === module`** in ESM: `require` is not defined.
- **Not escaping visitor text in HTML email.** A name containing markup is rendered by the staff
  member's mail client.
- **Enabling Bull Board without credentials.** The copied guard refuses to start; don't remove it.

## 10. Interview prep

**Q: Why use a queue for the lead email?**
A: Email providers are slow and fail independently. Doing it in the request would make lead capture
fail when the email provider fails. Enqueuing is a fast Redis write; the worker retries with
exponential backoff and the visitor's experience never depends on it.

**Q: What does at-least-once mean for your processor?**
A: A job can run more than once, so the processor checks `notifiedAt` before sending and sets it after.
Repeats are no-ops except in the narrow crash-after-send window, where a duplicate email is the
accepted cost — losing a lead notification isn't.

**Q: When do you not retry a job?**
A: When the input is invalid — it will fail the same way every time — so it throws an unrecoverable
error. A lead that no longer exists returns "skipped".

## 11. Resume-safe claim

"Moved lead notifications to an idempotent BullMQ worker with exponential-backoff retries, job-id
deduplication, and no personal data in queue payloads."

## 12. Definition of done

- [ ] The test script produces one email (or console print) and sets `notifiedAt`
- [ ] Two enqueues for one lead produce one job
- [ ] A failing send retries with growing delays
- [ ] The job survives an API restart
- [ ] `pnpm --filter api worker` processes jobs standalone
- [ ] Shutdown order: server → workers → database → Redis
- [ ] Bull Board requires credentials when enabled
