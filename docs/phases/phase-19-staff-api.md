# Phase 19 — Staff API: leads, handoff queue, transcripts

## 1. Goal

Give staff the data the spec asks for, behind login:

| Endpoint                             | Returns                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `GET /staff/leads?page&limit`        | captured leads, newest first, paginated                          |
| `GET /staff/handoffs?status=pending` | conversations waiting for a human, with the lead name if any     |
| `GET /staff/conversations/:id`       | the full transcript: messages, intents, citations, lead, handoff |
| `POST /staff/handoffs/:id/resolve`   | marks a handoff resolved by the signed-in staff member           |

Pagination follows e-commerce exactly: rows in `data`, `{ page, limit, total, hasMore }` in `meta`,
using the same `paginationQuerySchema` (max 100 per page).

## 2. What I will understand after this phase

1. How to paginate with limit/offset and report `hasMore` honestly.
2. Why "resolve" is a conditional update, and how that prevents double resolution.
3. When a join is clearer in SQL than in ORM calls, and when separate queries are clearer still.
4. How a second migration adds a column and foreign key to a table that already has rows.

## 3. Prerequisites

- Phase 18 done: leads and handoffs are being created.

## 4. Files

```
packages/types/src/common.ts                 (paginationQuerySchema, PaginationMeta — COPY from e-commerce)
packages/types/src/staff.ts                  NEW  handoff list query schema
apps/api/src/
├── prisma/contract.prisma                   (Handoff.resolvedById → User)
├── constants/rateLimiter.constant.ts        (STAFF_API_PREFIX)
├── config/rateLimiter.ts                    (staffApiLimiter — ADAPT mongo's protectedApiLimiter)
├── services/staff.service.ts                NEW
├── controllers/staff.controller.ts          NEW
├── routes/staff.route.ts                    NEW
└── app.ts                                   (mount /staff)
```

## 5. Concepts

**Limit/offset pagination.** `LIMIT 25 OFFSET 50` returns rows 51–75. It's simple and lets the UI jump
to any page; its cost grows with the offset, which doesn't matter at a few thousand leads. The total
comes from a `count` run in parallel with the page query; `hasMore = page × limit < total`, exactly as
e-commerce's order listing computes it. (Cursor pagination — "rows after this id" — scales better and
doesn't shift when new rows arrive; it's worth it for infinite feeds, not a staff table.)

**Resolve as a conditional update.** Two staff members click "Resolve" at the same moment. "Read the
handoff, check it's pending, write resolved" lets both succeed. `UPDATE … WHERE id = $1 AND status =
'pending'` lets exactly one succeed; the other updates zero rows and gets `409 Already resolved`. The
same "the WHERE clause encodes the rule" technique as refresh rotation (Phase 07).

**Choosing query styles.** The lead list is a single table: the ORM is clearest. The handoff queue
joins three tables (handoff, conversation, lead) and needs the latest message per conversation: one
SQL query says that directly. The transcript is four simple reads (conversation, messages, their
citations, lead + handoff): separate queries are easier to read than one query with nested
aggregates, and four indexed lookups are instant.

**A migration on a table with data.** `resolvedById` is added as a **nullable** column with a foreign
key to `user`, `ON DELETE SET NULL`. Nullable because existing handoffs have no resolver; `SET NULL`
so deleting a staff account keeps the history and only forgets who resolved it.

## 6. Steps

### Step 1 — Shared schemas

COPY `paginationQuerySchema`, `PaginationQuery` and `PaginationMeta` from
`e-commerce/packages/types/src/product.ts` (with its comment) into `packages/types/src/common.ts`.
Change only the default page size, 24 → 25 (a staff table, not a product grid).

`packages/types/src/staff.ts`:

```ts
import { z } from "zod";
import { paginationQuerySchema } from "./common.js";

export const handoffListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "resolved"]).default("pending"),
});
```

Export both from `index.ts`.

### Step 2 — Contract change

In `Handoff`:

```prisma
    // Who resolved it. SetNull: removing a staff account keeps the history.
    resolvedById   Uuid?
    resolvedBy     User?             @relation(fields: [resolvedById], references: [id], onDelete: SetNull)
```

and on `User`: `resolvedHandoffs Handoff[]`.

```bash
cd apps/api && pnpm db:plan add_handoff_resolver && pnpm db:sql
```

Read the SQL: `ALTER TABLE "handoff" ADD COLUMN "resolvedById" uuid` (nullable, so instant on a
table with rows) and a foreign key with `ON DELETE SET NULL`. Then `pnpm db:migrate`.

### Step 3 — Staff rate limit

Copy mongo's `protectedApiLimiter` into `config/rateLimiter.ts` as `staffApiLimiter`, with its own
prefix `STAFF_API_PREFIX = "rl:staff"`. Keyed by `req.userId`, so it must run **after**
`authenticate`. 300 requests per 5 minutes per staff member: generous for clicking around, stops a
runaway client loop.

### Step 4 — `src/services/staff.service.ts`

```ts
import type { PaginationQuery } from "@repo/types";
import { orm, pool } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { CONFLICT, NOT_FOUND } from "../constants/http.js";

const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  hasMore: page * limit < total,
});

export const listLeads = async ({ page, limit }: PaginationQuery) => {
  const [rows, totals] = await Promise.all([
    orm.Lead.orderBy((l) => l.createdAt.desc())
      .select(
        "id",
        "conversationId",
        "name",
        "email",
        "phone",
        "caseType",
        "summary",
        "notifiedAt",
        "createdAt",
      )
      .limit(limit)
      .offset((page - 1) * limit)
      .all(),
    orm.Lead.aggregate((a) => ({ total: a.count() })),
  ]);
  return { rows, meta: pageMeta(page, limit, Number(totals.total)) };
};

type HandoffRow = {
  id: string;
  conversationId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  leadName: string | null;
  lastMessage: string | null;
};

export const listHandoffs = async ({
  page,
  limit,
  status,
}: PaginationQuery & { status: "pending" | "resolved" }) => {
  const [{ rows }, count] = await Promise.all([
    pool.query<HandoffRow>(
      `SELECT h.id, h."conversationId", h.reason, h.status, h."createdAt", h."resolvedAt",
              l.name AS "leadName",
              (SELECT left(m.content, 160) FROM message m
                WHERE m."conversationId" = h."conversationId" AND m.role = 'user'
                ORDER BY m."createdAt" DESC LIMIT 1) AS "lastMessage"
       FROM handoff h
       LEFT JOIN lead l ON l."conversationId" = h."conversationId"
       WHERE h.status = $1
       ORDER BY h."createdAt" ${status === "pending" ? "ASC" : "DESC"}
       LIMIT $2 OFFSET $3`,
      [status, limit, (page - 1) * limit],
    ),
    pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM handoff WHERE status = $1`,
      [status],
    ),
  ]);
  return { rows, meta: pageMeta(page, limit, Number(count.rows[0]!.total)) };
};

export const getTranscript = async (conversationId: string) => {
  const conversation = await orm.Conversation.where({ id: conversationId })
    .select("id", "status", "createdAt", "updatedAt")
    .first();
  appAssert(conversation, NOT_FOUND, "Conversation not found");

  const [messages, lead, handoff] = await Promise.all([
    orm.Message.where({ conversationId })
      .orderBy((m) => m.createdAt.asc())
      .select(
        "id",
        "role",
        "content",
        "intent",
        "promptVersion",
        "totalMs",
        "createdAt",
      )
      .all(),
    orm.Lead.where({ conversationId }).first(),
    orm.Handoff.where({ conversationId }).first(),
  ]);

  const messageIds = messages.map((m) => m.id);
  const citations = messageIds.length
    ? await orm.MessageCitation.where((c) => c.messageId.in(messageIds))
        .orderBy((c) => c.number.asc())
        .select("messageId", "number", "url", "heading")
        .all()
    : [];

  return {
    conversation,
    lead,
    handoff,
    messages: messages.map((m) => ({
      ...m,
      citations: citations.filter((c) => c.messageId === m.id),
    })),
  };
};

export const resolveHandoff = async (
  handoffId: string,
  staffUserId: string,
) => {
  const now = new Date().toISOString();
  // Only a pending handoff can be resolved; of two simultaneous clicks, exactly one matches.
  const resolved = await orm.Handoff.where({
    id: handoffId,
    status: "pending",
  }).update({
    status: "resolved",
    resolvedAt: now,
    resolvedById: staffUserId,
  });

  if (!resolved) {
    const exists = await orm.Handoff.where({ id: handoffId })
      .select("id")
      .first();
    appAssert(exists, NOT_FOUND, "Handoff not found");
    appAssert(false, CONFLICT, "Already resolved");
  }

  await orm.Conversation.where({ id: resolved!.conversationId }).update({
    status: "closed",
    updatedAt: now,
  });
  return resolved!;
};
```

- The only interpolation into SQL is the sort direction, chosen from two literal strings in code —
  never from the request. Values are `$n` parameters.
- Pending handoffs are listed oldest first (the one waiting longest is at the top); resolved ones newest
  first.
- `count(*)` comes back from `pg` as a string (Postgres `bigint` can exceed JavaScript's safe integer
  range), hence `Number(…)`. The ORM's aggregate is converted the same way to be safe.
- `appAssert(false, …)` after the existence check is the e-commerce idiom for "throw this specific
  error now", and narrows types for TypeScript.

### Step 5 — Controller and routes

`src/controllers/staff.controller.ts`:

```ts
import {
  handoffListQuerySchema,
  idParamSchema,
  paginationQuerySchema,
} from "@repo/types";
import { catchError } from "../utils/errors/index.js";
import { ok } from "../utils/api/index.js";
import { OK } from "../constants/http.js";
import {
  getTranscript,
  listHandoffs,
  listLeads,
  resolveHandoff,
} from "../services/staff.service.js";

export const listLeadsHandler = catchError(async (req, res) => {
  const { rows, meta } = await listLeads(
    paginationQuerySchema.parse(req.query),
  );
  res.status(OK).json(ok(rows, meta));
});

export const listHandoffsHandler = catchError(async (req, res) => {
  const { rows, meta } = await listHandoffs(
    handoffListQuerySchema.parse(req.query),
  );
  res.status(OK).json(ok(rows, meta));
});

export const transcriptHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await getTranscript(id)));
});

export const resolveHandoffHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await resolveHandoff(id, req.userId)));
});
```

`src/routes/staff.route.ts`:

```ts
import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import { staffApiLimiter } from "../config/rateLimiter.js";
import {
  listHandoffsHandler,
  listLeadsHandler,
  resolveHandoffHandler,
  transcriptHandler,
} from "../controllers/staff.controller.js";

export const staffRoutes = Router();

// Every staff route needs a live session; the limiter is keyed by the staff user, so it comes after.
staffRoutes.use(authenticate, staffApiLimiter);

staffRoutes.get("/leads", listLeadsHandler);
staffRoutes.get("/handoffs", listHandoffsHandler);
staffRoutes.get("/conversations/:id", transcriptHandler);
staffRoutes.post("/handoffs/:id/resolve", resolveHandoffHandler);
```

`app.ts`: `app.use("/staff", staffRoutes);` — mounted at its own prefix, so `router.use(authenticate)`
can only ever apply to `/staff/*` (the e-commerce `/health` bug came from routers mounted at `/`).

## 7. Commit points

1. `feat(types): add pagination and handoff list schemas`
2. `feat(db): record which staff member resolved a handoff`
3. `feat(api): add staff leads, handoff queue and transcript endpoints`
4. `feat(api): resolve handoffs with a conditional update`

## 8. Verify

```bash
J=/tmp/cd-cookies     # staff login cookie jar from Phase 07

curl -s -b $J "localhost:4000/staff/leads?limit=2" | jq '{count: (.data|length), meta}'
# meta: {"page":1,"limit":2,"total":N,"hasMore":true|false}

curl -s -b $J "localhost:4000/staff/handoffs" | jq '.data[] | {reason, leadName, lastMessage}'

curl -s -b $J "localhost:4000/staff/conversations/<conversationId>" | jq '.data.messages[] | {role, intent, citations: (.citations|length)}'

# Resolve twice: 200 then 409
curl -s -b $J -X POST "localhost:4000/staff/handoffs/<handoffId>/resolve" | jq .status
curl -s -b $J -X POST "localhost:4000/staff/handoffs/<handoffId>/resolve" | jq '.errors[0].message'   # "Already resolved"

# Validation and auth
curl -s -b $J "localhost:4000/staff/leads?limit=500" | jq .errors          # 400, limit max 100
curl -s -b $J "localhost:4000/staff/conversations/not-a-uuid" | jq .errors # 400
curl -s "localhost:4000/staff/leads" | jq .errors                          # 401
```

## 9. Common mistakes

- **Building SQL with the `status` query value.** Here it only picks between two literal strings in
  code after Zod has validated it; values always go through `$n`.
- **Mounting the staff router at `/`.** `router.use(authenticate)` then runs for every request that
  reaches it, including public ones.
- **Read-then-write resolve.** Two staff both "win" and the audit trail is wrong.
- **Forgetting `Number()` on counts.** `"12" + 1` is `"121"`.
- **Returning the visitor's personal data on any non-staff route.** Only `/staff/*` returns leads.

## 10. Interview prep

**Q: How is the staff data protected?**
A: Every `/staff` route runs `authenticate`, which checks the token and that the session still exists
in the database, then a per-staff rate limit. Visitors never have accounts, and no public route returns
lead data.

**Q: How do you stop two people resolving the same handoff?**
A: A conditional update — `WHERE id = $1 AND status = 'pending'`. One update matches, the other gets
zero rows and a 409.

**Q: Offset or cursor pagination?**
A: Offset for a staff table: page jumping is useful and the data is small. For an infinite feed or very
large tables I'd use cursor pagination keyed on `(createdAt, id)`.

## 11. Resume-safe claim

"Built authenticated, paginated staff APIs for leads, a human-handoff queue and transcripts, with
race-safe handoff resolution."

## 12. Definition of done

- [ ] All four endpoints work behind login and return 401 without it
- [ ] Pagination meta is correct at page boundaries (`hasMore` false on the last page)
- [ ] Resolving twice gives 200 then 409; `resolvedById` is the staff user; the conversation is `closed`
- [ ] The transcript includes intents and citations per message
