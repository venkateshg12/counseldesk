# Phase 26 — Integration tests

## 1. Goal

Write the integration tests that pin down the behaviours most likely to break silently — the
concurrency, persistence and protocol details that unit tests can't see and evals don't check:

| File                | Proves                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat.test.ts`      | SSE event order; message + citations saved together; legal advice makes no answer call; conversations are private; validation 400; provider outage → `error` event |
| `lead.test.ts`      | one lead + handoff + one queued email; repeat says "already"; invalid tool args save nothing; concurrent saves create one lead                                     |
| `auth.test.ts`      | login/me/logout; refresh rotation; grace window; reuse after grace revokes the session                                                                             |
| `staff.test.ts`     | pagination meta; resolve 200 then 409; 401 without login                                                                                                           |
| `rateLimit.test.ts` | the 21st chat message in the window is a 429 envelope                                                                                                              |

## 2. What I will understand after this phase

1. How to test a streaming endpoint by reading the whole SSE body.
2. How to test a race deterministically (two promises, one constraint).
3. How to test a time-based rule (the 30-second grace window) without waiting 30 seconds.
4. What "arrange, act, assert" looks like when the arrangement is a database state.

## 3. Prerequisites

- Phase 25 done: `test:integration` passes the health test.

## 4. Files

```
apps/api/test/
├── chat.test.ts
├── lead.test.ts
├── auth.test.ts
├── staff.test.ts
└── rateLimit.test.ts
```

## 5. Concepts

**Arrange, act, assert.** Each test sets up exactly the state it needs (database rows, scripted model
responses), performs one action (an HTTP request or a service call), and checks the outcome
(response, rows, queue). Shared setup goes in `beforeAll`/`beforeEach`; nothing depends on another
test having run first.

**Testing a race.** Two `saveLead` calls started together with `Promise.all` really do run
concurrently against Postgres (two pool connections). Whatever the interleaving, the unique index
admits one; the test asserts one `created: true`, one `false`, and one row. It doesn't need to force a
particular interleaving — it asserts the invariant that must hold for all of them.

**Testing time without waiting.** The grace window compares `now` with `session.rotatedAt`. Instead of
sleeping 31 seconds, the test moves `rotatedAt` 60 seconds into the past with one `UPDATE` — the same
state the server would see after waiting.

**What not to assert.** Exact token boundaries, log output, timing numbers: they change for reasons
unrelated to correctness. Assert the contract: event types and order, rows, statuses, error codes.

## 6. Steps

### `test/chat.test.ts`

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEGAL_ADVICE_REPLY } from "../src/ai/prompts/index.js";
import { ingestPages } from "../src/services/ingest.service.js";
import { pool } from "../src/prisma/db.js";
import {
  createClient,
  fakeLlm,
  readSse,
  resetDb,
  startApp,
} from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  await ingestPages({ depth: 3 }); // real pages, fake embeddings
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  fakeLlm.reset();
  await pool.query("TRUNCATE conversation CASCADE");
});

const ask = (
  client: ReturnType<typeof createClient>,
  message: string,
  conversationId?: string,
) =>
  client("/chat", {
    method: "POST",
    body: JSON.stringify({ message, conversationId }),
  });

describe("POST /chat", () => {
  it("streams meta, tokens, citations, done — and saves the answer with its citation", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "question", reason: "test" } },
      { kind: "text", text: "A first DUI starts at a flat fee of $2,500 [1]." },
    );
    const client = createClient(app.baseUrl);

    const response = await ask(client, "How much is a first DUI?");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(response);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe("meta");
    expect(types.filter((t) => t === "token").length).toBeGreaterThan(1);
    expect(types.slice(-2)).toEqual(["citations", "done"]);

    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations).toHaveLength(
      1,
    );

    const { rows } = await pool.query(
      `SELECT m.role, m.intent, count(c.id)::int AS citations FROM message m
       LEFT JOIN "messageCitation" c ON c."messageId" = m.id GROUP BY m.id ORDER BY m."createdAt"`,
    );
    expect(rows).toEqual([
      { role: "user", intent: null, citations: 0 },
      { role: "assistant", intent: "question", citations: 1 },
    ]);
  });

  it("refuses legal advice with the fixed reply and never calls the answer model", async () => {
    fakeLlm.push({
      kind: "json",
      data: { intent: "legal_advice", reason: "test" },
    });
    const events = await readSse(
      await ask(createClient(app.baseUrl), "Will I go to jail?"),
    );

    const text = events
      .flatMap((e) => (e.type === "token" ? [e.text] : []))
      .join("");
    expect(text).toBe(LEGAL_ADVICE_REPLY);
    expect(fakeLlm.calls().map((c) => c.method)).toEqual(["generateJson"]);
  });

  it("does not let another visitor continue a conversation", async () => {
    fakeLlm.push({
      kind: "json",
      data: { intent: "small_talk", reason: "test" },
    });
    const first = await readSse(await ask(createClient(app.baseUrl), "hi"));
    const meta = first[0];
    if (meta?.type !== "meta") throw new Error("expected meta first");

    const intruder = createClient(app.baseUrl); // different visitorId cookie
    const events = await readSse(
      await ask(intruder, "hi again", meta.conversationId),
    );
    expect(events).toEqual([
      { type: "error", message: "Conversation not found", code: "APP_ERROR" },
    ]);
  });

  it("rejects an empty message with a 400 envelope before streaming", async () => {
    const response = await ask(createClient(app.baseUrl), "");
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("error");
  });

  it("sends an error event when the model is unavailable", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "question", reason: "test" } },
      {
        kind: "error",
        error: Object.assign(new Error("down"), { status: 503 }),
      },
    );
    const events = await readSse(
      await ask(createClient(app.baseUrl), "What are your hours?"),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "LLM_UNAVAILABLE",
    });
  });
});
```

- `TRUNCATE conversation CASCADE` before each test clears conversations, messages, citations, leads
  and handoffs, but keeps the ingested pages.
- The "unavailable" test works because in fake mode there's one provider: when it fails before the first
  token, there's no fallback left, so `streamText` throws `LLM_UNAVAILABLE` (Phase 14).
- The privacy test expects the conversation check's `appAssert` to produce code `APP_ERROR` (no
  specific error code was given). If you'd rather the widget distinguish it, give it a code — then
  update this assertion.

### `test/lead.test.ts`

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEAD_ALREADY_SAVED_REPLY } from "../src/ai/prompts/index.js";
import { saveLead } from "../src/services/lead.service.js";
import { notifyQueue } from "../src/jobs/queues/notify.queue.js";
import { orm, pool } from "../src/prisma/db.js";
import {
  createClient,
  fakeLlm,
  readSse,
  resetDb,
  startApp,
} from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(async () => {
  await notifyQueue.close();
  await app.close();
});
beforeEach(() => resetDb());

const say = async (
  client: ReturnType<typeof createClient>,
  message: string,
  conversationId?: string,
) =>
  readSse(
    await client("/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    }),
  );

const textOf = (events: Awaited<ReturnType<typeof say>>) =>
  events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");

describe("lead capture", () => {
  it("saves one lead and handoff, marks the conversation, and queues one email", async () => {
    const client = createClient(app.baseUrl);
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: { name: "Ana Diaz", phone: "602-555-0100", caseType: "dui" },
        },
      },
    );
    const events = await say(client, "Ana Diaz, 602-555-0100, DUI");
    expect(textOf(events)).toContain("Thank you, Ana Diaz");

    const { rows } = await pool.query(
      `SELECT c.status, l.id AS "leadId", h.status AS handoff FROM conversation c
       JOIN lead l ON l."conversationId" = c.id JOIN handoff h ON h."conversationId" = c.id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "needs_human",
      handoff: "pending",
    });
    expect(await notifyQueue.getJob(`lead:${rows[0].leadId}`)).toBeDefined();

    // Asking again in the same conversation: no tool call, no second lead.
    const meta = events[0];
    if (meta?.type !== "meta") throw new Error("expected meta first");
    fakeLlm.push({
      kind: "json",
      data: { intent: "wants_lawyer", reason: "test" },
    });
    expect(
      textOf(await say(client, "I want a lawyer", meta.conversationId)),
    ).toBe(LEAD_ALREADY_SAVED_REPLY);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM lead")).rows[0].n,
    ).toBe(1);
  });

  it("saves nothing when the tool arguments are invalid", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: { name: "Bo", phone: "call me", caseType: "family_law" },
        },
      },
    );
    const text = textOf(
      await say(createClient(app.baseUrl), "Bo, call me, divorce"),
    );
    expect(text).toContain("phone number or email address");
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM lead")).rows[0].n,
    ).toBe(0);
  });

  it("creates exactly one lead when two saves race", async () => {
    const conversation = await orm.Conversation.create({ visitorId: "race" });
    const args = {
      name: "Sam Kim",
      email: "sam@example.com",
      caseType: "dui" as const,
    };

    const results = await Promise.all([
      saveLead(conversation.id, args),
      saveLead(conversation.id, args),
    ]);

    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0].lead.id).toBe(results[1].lead.id);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM lead")).rows[0].n,
    ).toBe(1);
  });
});
```

No worker runs in the test process (`createApp` doesn't import `worker.ts`), so the queued job stays
waiting and can be inspected. `resetDb` flushes Redis db 1, removing it before the next test.

### `test/auth.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashValue } from "../src/utils/auth/index.js";
import { orm, pool } from "../src/prisma/db.js";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
const credentials = {
  email: "ana@firm.test",
  password: "correct horse battery",
};

beforeAll(async () => {
  await resetDb();
  await orm.User.create({
    email: credentials.email,
    name: "Ana Diaz",
    passwordHash: await hashValue(credentials.password),
  });
  app = await startApp();
});
afterAll(() => app.close());

const login = async () => {
  const client = createClient(app.baseUrl);
  const response = await client("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  return client;
};

describe("staff auth", () => {
  it("logs in, reads /auth/me, logs out", async () => {
    const client = await login();
    expect((await client("/auth/me")).status).toBe(200);

    await client("/auth/logout", { method: "POST" });
    expect((await client("/auth/me")).status).toBe(401);
  });

  it("rejects a wrong password with the same message as an unknown email", async () => {
    const client = createClient(app.baseUrl);
    const wrong = await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...credentials, password: "nope" }),
    });
    const unknown = await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "x@firm.test", password: "nope" }),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("rotates the refresh token, tolerates a just-replaced one, and revokes on later reuse", async () => {
    const client = await login();
    const first = client.cookie("refreshToken")!;

    expect((await client("/auth/refresh")).status).toBe(200);
    expect(client.cookie("refreshToken")).not.toBe(first); // rotated

    // Replaying the old token right away: inside the 30 s grace window, accepted.
    client.setCookie("refreshToken", first);
    expect((await client("/auth/refresh")).status).toBe(200);

    // Pretend the rotation happened a minute ago, then replay again: treated as theft.
    await pool.query(
      `UPDATE session SET "rotatedAt" = now() - interval '60 seconds'`,
    );
    client.setCookie("refreshToken", first);
    const reused = await client("/auth/refresh");
    expect(reused.status).toBe(401);
    expect((await reused.json()).errors[0].message).toBe("Session revoked");
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM session")).rows[0].n,
    ).toBe(0);
  });

  it("stops working as soon as the session row is gone", async () => {
    const client = await login();
    await pool.query("DELETE FROM session");
    expect((await client("/auth/me")).status).toBe(401);
  });
});
```

Notice the "replay inside the grace window" assertion: the second refresh in that test presents the
_old_ token; the server finds it was replaced seconds ago and returns the current one. If someone later
"simplifies" rotation by removing the grace check, this test fails.

### `test/staff.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashValue } from "../src/utils/auth/index.js";
import { orm } from "../src/prisma/db.js";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
let handoffId: string;

beforeAll(async () => {
  await resetDb();
  await orm.User.create({
    email: "ana@firm.test",
    name: "Ana",
    passwordHash: await hashValue("correct horse battery"),
  });
  for (const name of ["Lead One", "Lead Two"]) {
    const conversation = await orm.Conversation.create({ visitorId: name });
    await orm.Lead.create({
      conversationId: conversation.id,
      name,
      phone: "602-555-0100",
      caseType: "dui",
    });
    const handoff = await orm.Handoff.create({
      conversationId: conversation.id,
      reason: "test",
    });
    handoffId = handoff.id;
  }
  app = await startApp();
});
afterAll(() => app.close());

describe("staff API", () => {
  it("requires login", async () => {
    expect((await fetch(`${app.baseUrl}/staff/leads`)).status).toBe(401);
  });

  it("paginates leads", async () => {
    const client = createClient(app.baseUrl);
    await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ana@firm.test",
        password: "correct horse battery",
      }),
    });

    const page1 = await (await client("/staff/leads?limit=1")).json();
    expect(page1.data).toHaveLength(1);
    expect(page1.meta).toEqual({ page: 1, limit: 1, total: 2, hasMore: true });

    const page2 = await (await client("/staff/leads?limit=1&page=2")).json();
    expect(page2.meta.hasMore).toBe(false);
  });

  it("resolves a handoff once", async () => {
    const client = createClient(app.baseUrl);
    await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ana@firm.test",
        password: "correct horse battery",
      }),
    });

    expect(
      (await client(`/staff/handoffs/${handoffId}/resolve`, { method: "POST" }))
        .status,
    ).toBe(200);
    expect(
      (await client(`/staff/handoffs/${handoffId}/resolve`, { method: "POST" }))
        .status,
    ).toBe(409);
  });
});
```

### `test/rateLimit.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(() => app.close());

describe("chat rate limit", () => {
  it("allows 20 messages per visitor per 10 minutes, then answers 429", async () => {
    const client = createClient(app.baseUrl);
    const send = () =>
      client("/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      });

    for (let i = 0; i < 20; i++) {
      const response = await send();
      expect(response.status).toBe(200);
      await response.text(); // drain the stream
    }
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await limited.json()).errors[0].code).toBe("TOO_MANY_REQUESTS");
  });
});
```

"hi" is routed by the fake's heuristics as small talk: a fixed reply, no retrieval, fast. The test is
about the limiter, so the cheapest successful request is the right one.

## 7. Commit points

1. `test(api): cover chat streaming, refusal, privacy and outage`
2. `test(api): cover lead capture, invalid tool args and concurrent saves`
3. `test(api): cover staff auth, refresh rotation and reuse detection`
4. `test(api): cover staff pagination and handoff resolution`
5. `test(api): cover the chat rate limit`

## 8. Verify

```bash
docker compose up -d --wait
pnpm --filter api test:integration
# ✓ test/health.test.ts (1)
# ✓ test/chat.test.ts (5)
# ✓ test/lead.test.ts (3)
# ✓ test/auth.test.ts (4)
# ✓ test/staff.test.ts (3)
# ✓ test/rateLimit.test.ts (1)

# Prove a test can fail: break something on purpose and watch it go red, then restore it.
#  - remove the refreshJti condition from the rotation update → auth reuse test fails
#  - remove @unique from Lead.conversationId (in a scratch branch) → race test fails
#  - save citations outside the transaction and throw between → chat test fails
```

A test you've never seen fail hasn't proved anything. Do at least the first of those three.

## 9. Common mistakes

- **Not draining SSE responses** in loops: open connections pile up and later requests hang.
- **Sharing a cookie jar between "different visitors".** Create a new client for each.
- **Sleeping to test time.** Move the timestamp in the database instead.
- **Asserting exact `token` events.** The fake splits by words; the real provider splits differently.
  Assert the joined text.
- **Forgetting `notifyQueue.close()`** in a test file that imports the queue: Vitest waits for the open
  Redis connection and the run hangs at the end.

## 10. Interview prep

**Q: What do your integration tests cover that unit tests don't?**
A: The SSE contract, transactional persistence, ownership checks, the lead race under a unique
constraint, refresh-token rotation including the grace window and reuse detection, and the rate
limiter — all against real Postgres and Redis.

**Q: How do you test a race condition?**
A: Start both operations concurrently and assert the invariant that must hold for every interleaving —
here, exactly one lead row and exactly one `created: true` — rather than trying to force an order.

## 11. Resume-safe claim

"Wrote [N] integration tests against real Postgres and Redis covering SSE streaming, transactional
persistence, refresh-token reuse detection, concurrent lead creation and rate limiting."

## 12. Definition of done

- [ ] All six test files pass locally
- [ ] I broke at least one guarded behaviour on purpose and saw its test fail
- [ ] The run finishes without hanging (all connections closed)
