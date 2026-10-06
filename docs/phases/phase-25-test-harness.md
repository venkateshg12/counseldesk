# Phase 25 — Test harness: a test database, a fake LLM, and test helpers

## 1. Goal

Make the API testable end to end without real model calls, without touching development data, and
deterministically. After this phase:

- `pnpm --filter api test` runs fast unit tests (already exist);
- `pnpm --filter api test:integration` starts the real Express app against a **separate test
  database** and a separate Redis database, with the **fake LLM provider**, and runs HTTP tests;
- the same fake provider can run the whole stack for end-to-end tests (Phase 38) with
  `LLM_PROVIDER=fake`, and is refused in production.

## 2. What I will understand after this phase

1. Unit vs integration tests, and what each catches that the other can't.
2. Why integration tests use a real Postgres and Redis but a fake LLM.
3. How a test double for an LLM works: scripted responses for exact tests, simple rules for E2E.
4. How "feature hashing" gives deterministic fake embeddings that still make vector search meaningful.
5. How to isolate test data (separate database, truncation between tests).

## 3. Prerequisites

- Phase 24 done.

## 4. Files

```
apps/api/
├── .env.test                           NEW  (committed: no secrets in it)
├── vitest.config.ts                    (unit only)
├── vitest.integration.config.ts        NEW
├── test/
│   ├── globalSetup.ts                  NEW  create test DB, migrate, flush Redis db
│   ├── setup.ts                        NEW  load .env.test
│   └── helpers.ts                      NEW  startApp, resetDb, readSse, fake LLM controls
└── src/
    ├── constants/env.ts                (LLM_PROVIDER, REDIS_DB; production guard)
    ├── config/redis.ts                 (db index)
    ├── ai/providers/fake.ts            NEW  scripted + heuristic fake provider
    ├── ai/embeddings.ts                (fake embeddings by feature hashing)
    ├── ai/llm.ts                       (provider list respects LLM_PROVIDER)
    ├── services/ingest.service.ts      NEW  (moved out of scripts/ingest.ts)
    └── scripts/ingest.ts               (now a thin wrapper)
```

## 5. Concepts

**Unit vs integration.** Unit tests (RRF, splitter, citations, metrics) check pure logic in
milliseconds. They can't tell you that the SQL matches the index, that the transaction commits citations
with the message, that a cookie is set with the right path, or that the SSE stream has the right event
order. Integration tests send real HTTP requests to the real app with a real database and catch exactly
those.

**Real database, fake model.** Postgres and Redis behaviour (constraints, transactions, Lua) is what the
integration tests are _about_, so they're real. The model is slow, costs quota, and is non-deterministic —
an integration test that asserts on generated text would flake. So the model is replaced by a fake that
returns exactly what the test says it should.

**Two modes of the fake.**

- _Scripted:_ a test pushes the responses the next calls should return ("route → legal_advice"). If
  nothing is queued, the fake falls back to:
- _Heuristic:_ tiny keyword rules ("lawyer" → `wants_lawyer`, "will I" → `legal_advice"`), a canned
  grounded answer citing `[1]`, and a regex-based lead extractor. Crude on purpose: it exists so the
  E2E tests (Phase 38) can drive the full UI without API keys, not to be smart.

**Feature hashing for fake embeddings.** Each word of a text is hashed to one of the 768 dimensions and
adds 1 there; the vector is then normalised. Texts sharing words point in similar directions, so cosine
search still ranks "DUI fees" near the section about DUI fees — deterministic, free, offline.

**Isolation.** Tests use `counseldesk_test` (a second database in the same container) and Redis logical
database 1. Every test file starts by truncating all tables and flushing Redis db 1. Development data is
never touched; tests never depend on each other's leftovers.

**Production guard.** `LLM_PROVIDER=fake` with `NODE_ENV=production` throws at boot. A test switch that
can reach production eventually does.

## 6. Steps

### Step 1 — Env knobs

`env.ts`:

```ts
// "real" uses Gemini + Groq; "fake" uses the scripted/heuristic provider (tests and E2E only).
export const LLM_PROVIDER = getEnv("LLM_PROVIDER", "real");
if (LLM_PROVIDER === "fake" && NODE_ENV === "production") {
  throw new Error("LLM_PROVIDER=fake is not allowed in production");
}
// Redis logical database. Tests use 1 so flushing it never touches development data.
export const REDIS_DB = getEnv("REDIS_DB", "0");
```

Move the Gemini and Groq env reads behind the switch so tests need no keys: in `env.ts` give
`GEMINI_API_KEY`, `GROQ_API_KEY`, `GEMINI_CHAT_MODEL`, `GROQ_CHAT_MODEL` and `GEMINI_EMBEDDING_MODEL`
a default of `""` **only when** `LLM_PROVIDER === "fake"`:

```ts
const llmDefault = LLM_PROVIDER === "fake" ? "fake" : undefined;
export const GEMINI_API_KEY = getEnv("GEMINI_API_KEY", llmDefault);
// …same for the other four
```

(`LLM_PROVIDER` and `NODE_ENV` must therefore be declared above these lines.)

`config/redis.ts`: add `db: Number(REDIS_DB),` to both `getRedisConfig` and
`getRateLimiterRedisConfig`.

### Step 2 — `src/ai/providers/fake.ts`

```ts
import type { LlmProvider, StreamEvent, ToolResult, Usage } from "../types.js";
import { routerV1 } from "../prompts/index.js";

type Scripted =
  | { kind: "json"; data: unknown }
  | { kind: "text"; text: string }
  | { kind: "tool"; result: ToolResult }
  | { kind: "error"; error: Error };

const queue: Scripted[] = [];
const calls: { method: string; system: string; lastUserMessage: string }[] = [];

// Test controls. Each scripted item answers exactly one call, in order.
export const fakeLlm = {
  push: (...items: Scripted[]) => queue.push(...items),
  reset: () => {
    queue.length = 0;
    calls.length = 0;
  },
  calls: () => [...calls],
};

const USAGE: Usage = { inputTokens: 100, outputTokens: 20 };

const next = (
  method: string,
  system: string,
  messages: { role: string; content: string }[],
) => {
  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  calls.push({ method, system, lastUserMessage });
  const item = queue.shift();
  if (item?.kind === "error") throw item.error;
  return { item, lastUserMessage };
};

// Heuristics for unscripted calls (E2E). Deliberately crude.
const routeByKeywords = (text: string) => {
  const t = text.toLowerCase();
  if (/(lawyer|consultation|call me|talk to|@|\d{3}[-.\s]\d{4})/.test(t))
    return "wants_lawyer";
  if (/(will i|should i|my case|am i going)/.test(t)) return "legal_advice";
  if (/(python|poem|pizza|ignore (all|your)|system prompt)/.test(t))
    return "out_of_scope";
  if (/^(hi|hello|hey|thanks|thank you)\b/.test(t)) return "small_talk";
  return "question";
};

const extractLead = (text: string): ToolResult => {
  const phone = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/)?.[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  const name = text
    .split(",")[0]
    ?.replace(/^(i'?m|my name is)\s+/i, "")
    .trim();
  const caseType = /dui|drunk/i.test(text)
    ? "dui"
    : /divorce|custody/i.test(text)
      ? "family_law"
      : /accident|injur/i.test(text)
        ? "personal_injury"
        : null;
  if (name && (phone || email) && caseType) {
    return {
      type: "tool_call",
      name: "createLead",
      args: { name, phone, email, caseType },
    };
  }
  return {
    type: "text",
    text: "Could you share your name, a phone number or email, and the type of case?",
  };
};

export const createFakeProvider = (): LlmProvider => ({
  name: "gemini",
  model: "fake",

  async generateJson({ system, messages, schema }) {
    const { item, lastUserMessage } = next("generateJson", system, messages);
    const data =
      item?.kind === "json"
        ? item.data
        : system === routerV1.system
          ? { intent: routeByKeywords(lastUserMessage), reason: "fake" }
          : {};
    return { data: schema.parse(data), usage: USAGE };
  },

  async *streamText({ system, messages }) {
    const { item } = next("streamText", system, messages);
    const text =
      item?.kind === "text"
        ? item.text
        : "Harbor & Vale Law can help with that [1].";
    for (const word of text.split(/(?<= )/))
      yield { type: "text", text: word } satisfies StreamEvent;
    yield { type: "done", usage: USAGE };
  },

  async callTools({ system, messages }) {
    const { item, lastUserMessage } = next("callTools", system, messages);
    const result =
      item?.kind === "tool"
        ? item.result
        : item?.kind === "text"
          ? { type: "text" as const, text: item.text }
          : extractLead(lastUserMessage);
    return { result, usage: USAGE };
  },
});
```

- `name: "gemini"` keeps the provider type unchanged; the `model: "fake"` field is what shows in
  `llmCall` rows.
- `fakeLlm.calls()` lets a test assert, for example, that a legal-advice message made **no**
  `streamText` call.
- Streaming word by word means SSE tests see several `token` events, like the real thing.

### Step 3 — Wire the fake in

`llm.ts`:

```ts
import { LLM_PROVIDER } from "../constants/env.js";
import { createFakeProvider } from "./providers/fake.js";

const providers: LlmProvider[] =
  LLM_PROVIDER === "fake"
    ? [createFakeProvider()]
    : LLM_PRIMARY === "groq"
      ? [groq, gemini]
      : [gemini, groq];
```

Create `gemini` and `groq` only when `LLM_PROVIDER !== "fake"` (the SDK clients don't need a key to be
constructed, but there's no reason to build them). `ai/gemini.ts` likewise only matters for real mode.

`embeddings.ts` — fake embeddings:

```ts
import { createHash } from "node:crypto";
import { LLM_PROVIDER } from "../constants/env.js";

// Feature hashing: each word adds 1 to one of the dimensions; then normalise to length 1.
// Texts that share words point in similar directions, so cosine search stays meaningful offline.
const fakeEmbedding = (text: string) => {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const bucket =
      createHash("md5").update(word).digest().readUInt32BE(0) %
      EMBEDDING_DIMENSIONS;
    vector[bucket]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
};
```

and at the top of `embedBatch`: `if (LLM_PROVIDER === "fake") return texts.map(fakeEmbedding);`.

### Step 4 — Ingestion as a service

Move the body of `scripts/ingest.ts` into `services/ingest.service.ts` as
`export const ingestPages = async ({ depth, force }: { depth: 2 | 3; force?: boolean }) => { … return { ingested, skipped, removed }; }`
(replace its `console.log`s with `logger.info`). `scripts/ingest.ts` becomes:

```ts
import "dotenv/config";
import { parseArgs } from "node:util";
import { ingestPages } from "../services/ingest.service.js";
import { closeDB } from "../config/db.js";

const { values } = parseArgs({
  options: {
    depth: { type: "string", default: "3" },
    force: { type: "boolean", default: false },
  },
});
const result = await ingestPages({
  depth: values.depth === "2" ? 2 : 3,
  force: values.force,
});
console.log(
  `done: ${result.ingested} ingested, ${result.skipped} unchanged, ${result.removed} removed`,
);
await closeDB();
```

Tests call `ingestPages` directly to load the real firm content with fake embeddings.

### Step 5 — `.env.test` (committed)

```bash
NODE_ENV=test
PORT=0
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=warn
DATABASE_URL=postgresql://counseldesk:counseldesk@localhost:5433/counseldesk_test
JWT_SECRET=test-access-secret-0123456789abcdef0123456789
JWT_REFRESH_SECRET=test-refresh-secret-0123456789abcdef012345678
REDIS_HOST=localhost
REDIS_PORT=6381
REDIS_DB=1
STAFF_NOTIFY_EMAIL=staff@test.local
SITE_URL=http://localhost:3000
LLM_PROVIDER=fake
```

These secrets protect nothing (a throwaway test database), which is why committing them is fine — and
why they must never be reused anywhere else. CI (Phase 28) overrides the host values.

### Step 6 — Vitest configs and setup

`vitest.config.ts` (unit, unchanged in spirit):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

`vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    // One database: test files run one after another, so truncation in one can't break another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

`test/setup.ts` — runs in each test worker before the test file imports the app:

```ts
import { config } from "dotenv";

config({ path: ".env.test", override: true });
```

`test/globalSetup.ts` — runs once before all files:

```ts
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

export default async function setup() {
  config({ path: ".env.test", override: true });
  const testUrl = process.env["DATABASE_URL"]!;
  const adminUrl = testUrl.replace(/\/counseldesk_test$/, "/counseldesk");

  // Create the test database once; it persists between runs.
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'counseldesk_test'",
  );
  if (exists.rowCount === 0)
    await admin.query("CREATE DATABASE counseldesk_test");
  await admin.end();

  // Same migrations as production; the env makes the CLI target the test database.
  execFileSync("pnpm", ["exec", "prisma", "db", "migrate"], {
    stdio: "inherit",
    env: process.env,
  });
}
```

`CREATE DATABASE` can't take a parameter, which is why the name is a literal, not interpolated.

### Step 7 — `test/helpers.ts`

```ts
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ChatEvent } from "@repo/types";
import { createApp } from "../src/app.js";
import { pool } from "../src/prisma/db.js";
import { redisConnection } from "../src/jobs/redis/connection.js";
import { fakeLlm } from "../src/ai/providers/fake.js";

export { fakeLlm };

export const startApp = async () => {
  const server: Server = createApp().listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};

// Every table except Prisma's own bookkeeping, emptied in one statement.
export const resetDb = async () => {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length)
    await pool.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  await redisConnection.flushdb();
  fakeLlm.reset();
};

// Reads a whole SSE response into its events.
export const readSse = async (response: Response) => {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
};

// fetch with a cookie jar, so the visitorId and auth cookies persist across calls in one test.
// `cookie` / `setCookie` let a test read a token or replay an old one.
export const createClient = (baseUrl: string) => {
  const jar = new Map<string, string>();
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...init.headers,
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const [name, value] = pair!.split("=");
      if (value) jar.set(name!, value);
      else jar.delete(name!);
    }
    return response;
  };
  return Object.assign(request, {
    cookie: (name: string) => jar.get(name),
    setCookie: (name: string, value: string) => jar.set(name, value),
  });
};
```

- `listen(0)` asks the OS for any free port, so tests never collide with your dev server.
- `getSetCookie()` returns every `Set-Cookie` header separately (Node 20+); a cleared cookie arrives with
  an empty value and is removed from the jar.
- The jar ignores cookie paths: the refresh cookie is sent on every request, which the API ignores
  except on `/auth/refresh`. Good enough for tests, and simpler than a full cookie implementation.

### Step 8 — Scripts

`package.json`:

```json
"test": "vitest run",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

A first smoke test, `test/health.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(() => app.close());

describe("GET /health", () => {
  it("reports postgres and redis up", async () => {
    const response = await fetch(`${app.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "success",
      data: { postgres: "up", redis: "up" },
    });
  });
});
```

## 7. Commit points

1. `feat(api): add fake llm provider and hashed fake embeddings, refused in production`
2. `refactor(api): move ingestion into a service`
3. `test(api): add integration test setup with isolated database and redis`
4. `test(api): add health integration test`

## 8. Verify

```bash
pnpm --filter api test                 # unit tests, unchanged
pnpm --filter api test:integration     # migrates counseldesk_test, runs health.test.ts
# ✓ test/health.test.ts (1 test)

# Dev data untouched
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c 'SELECT count(*) FROM section;'   # still your ingested sections

# Production guard
NODE_ENV=production LLM_PROVIDER=fake pnpm --filter api exec tsx src/index.ts
# Error: LLM_PROVIDER=fake is not allowed in production

# The whole API runs offline
LLM_PROVIDER=fake pnpm --filter api dev    # chat works with canned answers, no keys needed
```

## 9. Common mistakes

- **Pointing tests at the dev database.** One `TRUNCATE` and your ingested content and staff account
  are gone. `.env.test` must name `counseldesk_test`.
- **Mocking Postgres or Redis** in integration tests. Then you're testing your mocks.
- **Asserting on real model output.** Flaky by nature; that's what evals are for.
- **Running test files in parallel against one database.** They truncate each other's data mid-test.
- **A fake that's too clever.** If it needs tests of its own, it's become a second product.

## 10. Interview prep

**Q: How do you test code that calls an LLM?**
A: Two levels. Integration tests replace the model with a fake provider behind the same interface,
scripted per test, so assertions are exact and free; they exercise the real database, Redis, HTTP and
SSE. Model quality is measured separately by the eval suite with real models.

**Q: How do you keep tests isolated?**
A: A separate test database migrated with the production migrations, a separate Redis logical database,
everything truncated and flushed before each test file, and files run serially.

## 11. Resume-safe claim

"Built an integration-test harness with an isolated Postgres/Redis, production-identical migrations, and
an interface-compatible fake LLM (scripted for tests, heuristic for offline E2E)."

## 12. Definition of done

- [ ] `test:integration` creates and migrates `counseldesk_test` and passes the health test
- [ ] Dev database and Redis db 0 are untouched by tests
- [ ] `LLM_PROVIDER=fake` runs the API without any API keys; production refuses it
- [ ] Ingestion is a service called by the script
