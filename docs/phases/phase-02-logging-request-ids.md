# Phase 02 — Structured logging and request ids

## 1. Goal

Replace `console.log` with a small structured logger, and give every request an id that appears in
every log line that request produces, in the `X-Request-Id` response header, and later in the
`llm_calls` table.

e-commerce logs with `morgan` and `console.error`. That's readable on a laptop and useless in
production: when one chat answer is slow or wrong, there is no way to pull out "every line about that
one request" from interleaved output. This is listed as missing in e-commerce's own README.

This is written by hand, not with a logging library: the whole thing is under 80 lines, and the spec
doesn't name one. If you later want log shipping, sampling or transports, that's the point at which
a library like pino earns its place.

## 2. What I will understand after this phase

1. What structured (JSON) logging is and why a log collector needs it.
2. What a request id (correlation id) is and how it lets you trace one request across many log lines.
3. How `AsyncLocalStorage` gives code deep in a service access to "the current request" without
   passing `req` around (services must never touch `req` — the e-commerce rule).
4. Why some fields (passwords, tokens, cookies) must be redacted before they reach any log.

## 3. Prerequisites

- Phase 01 done: the server boots and `/health` works.

## 4. Files

```
apps/api/src/
├── constants/env.ts                    (LOG_LEVEL added)
├── utils/logger.ts                     NEW
├── utils/requestContext.ts             NEW
├── middleware/requestId.ts             NEW
├── middleware/errorHandler.ts          (console.error → logger)
├── app.ts                              (requestId mounted first)
└── index.ts                            (console.* → logger)
```

No new packages: `node:async_hooks` and `node:crypto` are built into Node.

## 5. Concepts

**Structured logging.** Each log line is one JSON object: `{"time":"…","level":"info","msg":"request
completed","requestId":"…","status":200,"durationMs":42}`. A collector (Render's log view, Datadog,
Loki) can then filter on `requestId = X` or `durationMs > 2000` instead of grepping prose. In
development a single readable line is friendlier, so the logger prints a human format when
`NODE_ENV=development`.

**Request id.** A random UUID created when a request arrives (or taken from an incoming
`X-Request-Id` set by a proxy, if it looks sane). It's attached to every log line for that request and
returned to the client in a header. When a user reports "the chat broke", the widget can show the id
and you search for it.

**`AsyncLocalStorage`.** Node keeps a value attached to an asynchronous call chain: everything that
runs "inside" `storage.run(value, fn)` — including code after `await` — can read `value`. Without it,
a service that wants to log the request id would need `req` passed in, which breaks the rule that
services never touch `req`/`res`. With it, `logger.info(...)` anywhere finds the id by itself.

**Validating an incoming id.** A client can send any `X-Request-Id`. Accepting it blindly would let
someone inject newlines or huge strings into your logs. The middleware accepts it only if it is at
most 64 characters of letters, digits and dashes; otherwise it generates its own.

**Redaction.** Logs are copied to more places and kept longer than databases, and are read by more
people. A password, token or cookie in a log line is a leaked credential. The logger replaces the
values of known-sensitive keys with `"[redacted]"`. Phase 24 extends the list with personal data
(email, phone) once leads exist.

## 6. Steps

### Step 1 — `LOG_LEVEL` in `env.ts`

Append to `src/constants/env.ts`:

```ts
export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
```

### Step 2 — `utils/requestContext.ts`

```ts
import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(
  context: RequestContext,
  fn: () => T,
) => storage.run(context, fn);

// Undefined outside a request: boot, shutdown, background jobs, scripts.
export const getRequestId = () => storage.getStore()?.requestId;
```

### Step 3 — `utils/logger.ts`

```ts
import { LOG_LEVEL, NODE_ENV } from "../constants/env.js";
import { getRequestId } from "./requestContext.js";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const minLevel = LEVELS[LOG_LEVEL as Level] ?? LEVELS.info;

// Values under these keys never reach a log line, at any depth.
const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "apikey",
]);

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Error)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(inner),
      ]),
    );
  }
  return value;
};

// Errors don't serialise with JSON.stringify (their fields are non-enumerable).
const serialiseError = (error: Error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
});

const write = (level: Level, msg: string, fields: Fields = {}) => {
  if (LEVELS[level] < minLevel) return;

  const { error, ...rest } = fields;
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    requestId: getRequestId(),
    ...(redact(rest) as Fields),
    ...(error instanceof Error
      ? { error: serialiseError(error) }
      : error
        ? { error }
        : {}),
  };

  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (NODE_ENV === "development") {
    const { time, level: lvl, msg: message, ...details } = entry;
    const extra = Object.keys(details).length
      ? ` ${JSON.stringify(details)}`
      : "";
    stream.write(
      `${time.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${message}${extra}\n`,
    );
    return;
  }

  stream.write(`${JSON.stringify(entry)}\n`);
};

export const logger = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
```

What each block does:

- `LEVELS` / `minLevel`: messages below `LOG_LEVEL` are dropped (`debug` lines in production cost
  nothing).
- `redact`: walks objects and arrays and replaces sensitive values. It compares keys lowercased, so
  `accessToken` and `AccessToken` are both caught, but `access_token` is not (the underscore makes it
  a different string). Keep field names camelCase, as the rest of the code does.
- `serialiseError`: `JSON.stringify(new Error("x"))` gives `{}` because `message` and `stack` are not
  enumerable. Without this, every logged error would be empty.
- `requestId: getRequestId()`: undefined outside a request, and `JSON.stringify` drops undefined
  fields, so boot logs simply don't have one.
- Warnings and errors go to stderr, everything else to stdout. Hosts colour or alert on stderr.

### Step 4 — `middleware/requestId.ts`

```ts
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { runWithRequestContext } from "../utils/requestContext.js";
import { logger } from "../utils/logger.js";

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  const startedAt = process.hrtime.bigint();

  res.setHeader("X-Request-Id", id);

  // One access-log line per request, written when the response has been sent.
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    runWithRequestContext({ requestId: id }, () =>
      logger.info("request completed", {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      }),
    );
  });

  runWithRequestContext({ requestId: id }, next);
};
```

- `runWithRequestContext({ requestId: id }, next)`: everything the rest of the request does —
  routes, controllers, services, their `await`s — runs inside that context.
- The `finish` callback runs outside it (it's an event fired later), so it re-enters the context to
  log with the id.
- `originalUrl.split("?")[0]` leaves the query string out of the log; query strings sometimes carry
  tokens.
- `process.hrtime.bigint()` is a monotonic clock: unlike `Date.now()`, it can't jump if the system
  clock is adjusted mid-request.

### Step 5 — Mount it first, and use the logger everywhere

In `src/app.ts`, import and mount it **before helmet**, so even a request rejected by a later
middleware gets an id and an access log line:

```ts
import { requestId } from "./middleware/requestId.js";
// …
const app = express();
app.use(requestId);
app.use(helmet({/* unchanged */}));
```

In `src/middleware/errorHandler.ts`, replace `console.error("error", error)` with:

```ts
logger.error("unhandled error", {
  error,
  method: _req.method,
  path: _req.originalUrl.split("?")[0],
});
```

(rename `_req` to `req` now that it's used, and import `logger` from `../utils/logger.js`).

In `src/index.ts`, replace each `console.log` / `console.error` with `logger.info` / `logger.error`,
passing errors as a field:

```ts
logger.info("server listening", { port: Number(PORT) });
logger.info("shutdown started", { reason });
logger.error("in-flight requests did not finish in time, exiting anyway");
logger.info("shutdown complete");
logger.error("shutdown failed", { error });
logger.error("unhandled promise rejection", { error: reason });
logger.error("uncaught exception", { error });
// and in main().catch:
logger.error("startup failed", { error });
```

## 7. Commit points

1. `feat(api): add request context and structured logger with redaction`
2. `feat(api): add request id middleware with access log`
3. `refactor(api): route server and error logs through the logger`

## 8. Verify

```bash
pnpm --filter api dev
# 10:14:02 INFO  server listening {"port":4000}

curl -s -i localhost:4000/health | grep -i x-request-id
# X-Request-Id: 6f1c…  (a UUID)
# server terminal: 10:14:05 INFO  request completed {"requestId":"6f1c…","method":"GET","path":"/health","status":200,"durationMs":1}

# A sane incoming id is kept; an unsafe one is replaced
curl -s -i -H 'X-Request-Id: trace-123' localhost:4000/health | grep -i x-request-id   # trace-123
curl -s -i -H 'X-Request-Id: bad id with spaces' localhost:4000/health | grep -i x-request-id  # a UUID

# JSON format in production mode
NODE_ENV=production pnpm --filter api exec tsx src/index.ts
# {"time":"2026-…","level":"info","msg":"server listening","port":4000}

# Redaction (temporary check, delete afterwards): in app.ts add
#   logger.info("redaction test", { user: { email: "a@b.c", password: "hunter2" }, token: "abc" });
# → {"user":{"email":"a@b.c","password":"[redacted]"},"token":"[redacted]"}

# LOG_LEVEL=warn hides the access log lines
```

## 9. Common mistakes

- **Mounting `requestId` after other middleware.** Requests rejected earlier (CORS, body too large)
  get no id and no access line. It must be the first `app.use`.
- **Logging an error as a string** (`logger.error("failed: " + error)`). You lose the stack trace.
  Always pass `{ error }`.
- **Logging `req.body` "for debugging".** It will eventually contain a password or a visitor's phone
  number. Log the fields you need, by name.
- **Calling `getRequestId()` in a BullMQ job** and expecting a value. Jobs run outside any request; the
  job id is the correlation id there (Phase 09 logs it explicitly).
- **Trusting the incoming header without the regex.** A header with a newline can forge extra log
  lines in plain-text log viewers.

## 10. Interview prep

**Q: How would you debug one slow request in production?**
A: Every request gets an id, returned in `X-Request-Id` and attached to every structured log line
it produces, including the timing of each stage and each LLM call. I filter the logs by that id and
see exactly where the time went.

**Q: How does a service get the request id without access to `req`?**
A: `AsyncLocalStorage`. The middleware runs the rest of the request inside a context holding the id;
any code in that async chain, however deep, can read it. Services stay independent of Express.

**Q: Why not just use `console.log`?**
A: Plain text can't be filtered by field, has no levels to turn down in production, and gives you no
place to enforce redaction. A structured logger is a single choke point where all three happen.

**Q: Why not use pino?**
A: The requirements were JSON lines, levels, a request id and redaction — about 70 lines of code. A
library is worth it once you need transports, sampling or very high throughput; I'd switch then.

## 11. Resume-safe claim

"Implemented structured JSON logging with per-request correlation ids propagated via
AsyncLocalStorage, access logs with latency, and redaction of credentials."

## 12. Definition of done

- [ ] Every response has an `X-Request-Id` header
- [ ] Each request produces one `request completed` line with method, path, status and duration
- [ ] Unsafe incoming ids are replaced, safe ones kept
- [ ] Production mode prints one JSON object per line
- [ ] Sensitive keys print as `[redacted]`
- [ ] No `console.*` calls remain in `apps/api/src` (`grep -rn "console\." apps/api/src` is empty)
- [ ] Typecheck and lint pass
