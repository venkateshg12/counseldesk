# Phase 01 — API bootstrap

> **How to read this plan.** Phase 00 was dry-run before it was written. From this phase on, the
> code is written against verified package versions and current docs, but it has not been executed
> as a whole project. The Verify section is what you should see; if something differs, the
> difference is the thing to investigate, not to paper over.

## 1. Goal

Turn the Phase 00 skeleton into a real Express server with the e-commerce foundation: environment
validation at boot, the `AppError` / `appAssert` / `catchError` error trio, the `ok()` / `fail()`
response envelope, one error handler mounted last, a 404 handler, `/health`, and an ordered graceful
shutdown.

No feature routes yet. The point is that every later route lands in a server whose failure modes are
already handled: a missing env var stops boot, a thrown error becomes a clean JSON envelope, an
unknown URL returns a 404 envelope, and a deploy's SIGTERM doesn't cut requests off mid-flight.

One structural change from e-commerce: the Express app is built in `app.ts` by a `createApp()`
function, and `index.ts` only connects, listens and shuts down. e-commerce does all of it in
`index.ts`, which is why it has no API tests: you can't start that app without also binding a port
and connecting to MongoDB. Phase 25's integration tests call `createApp()` directly.

## 2. What I will understand after this phase

1. Why env validation happens at boot and not on first use.
2. How `catchError` turns an `async` controller's thrown error into `next(error)`, and why Express 5
   makes it optional but still useful.
3. Why the error handler must be the last middleware and has four parameters.
4. What "graceful shutdown" means concretely, and why the order is server → workers → database.
5. Why `app.ts` and `index.ts` are separate files.

## 3. Prerequisites

- Phase 00 done: `pnpm build`, `pnpm typecheck`, `pnpm lint` pass.
- `apps/api/.env` exists (copied from `.env.example`).

## 4. Files

```
apps/api/
├── package.json                             (dependencies added)
└── src/
    ├── index.ts                             ADAPT  e-commerce/apps/backends/mongo/src/index.ts
    ├── app.ts                               NEW    (split out of mongo index.ts)
    ├── constants/
    │   ├── env.ts                           ADAPT  e-commerce/apps/backends/mongo/src/constants/env.ts
    │   ├── http.ts                          COPY   e-commerce/apps/backends/postgres/src/constants/http.ts
    │   └── appErrorCode.ts                  COPY   e-commerce/apps/backends/mongo/src/constants/appErrorCode.ts
    ├── utils/
    │   ├── errors/
    │   │   ├── appError.ts                  COPY   e-commerce/apps/backends/mongo/src/utils/errors/appError.ts
    │   │   ├── appAssert.ts                 COPY   …/mongo/src/utils/errors/appAssert.ts
    │   │   ├── catchError.ts                COPY   …/mongo/src/utils/errors/catchError.ts
    │   │   └── index.ts                     COPY   …/mongo/src/utils/errors/index.ts
    │   └── api/
    │       ├── apiEnvelope.ts               COPY   …/mongo/src/utils/api/apiEnvelope.ts
    │       └── index.ts                     COPY   …/mongo/src/utils/api/index.ts
    └── middleware/
        ├── errorHandler.ts                  ADAPT  …/mongo/src/middleware/errorHandler.ts
        └── notFound.ts                      COPY   …/mongo/src/middleware/notFound.ts
```

The temporary Phase 00 `src/index.ts` is replaced.

## 5. Concepts

**Fail at boot, not at first use.** `env.ts` reads every variable when the module loads and throws if
one is missing. The alternative (reading `process.env.X` where it's used) means a missing secret is
discovered by the first user who triggers that code path, possibly days after a deploy that "worked".
A server that refuses to start is caught by the deploy itself.

**The error trio.** `AppError` is an `Error` with an HTTP status and an optional machine-readable
code. `appAssert(condition, status, message)` throws one when the condition is falsy, so services
read like a list of rules ("the session exists", "the lead belongs to a conversation") instead of
nested `if`/`throw`. TypeScript's `asserts condition` return type also narrows the value after the
call: after `appAssert(user, …)`, `user` is no longer `null` to the compiler.

**`catchError` in Express 5.** Express 4 ignored rejected promises from `async` handlers, so a thrown
error left the request hanging until it timed out. Express 5 forwards rejected promises to the error
handler itself. e-commerce still wraps every controller in `catchError`, and so does this project:
it costs nothing, makes the intent visible in every controller, and means the code doesn't silently
depend on one Express version's behaviour.

**Error handler, last, four parameters.** Express recognises error-handling middleware by its arity:
`(error, req, res, next)`. It only reaches it when something calls `next(error)` (or a promise
rejects), and only if it's registered after the routes that can fail. It is the single place that
decides what a client sees for a Zod error (400 with field messages), an `AppError` (its own status)
and anything else (500 with a generic message, the details logged, never sent).

**Graceful shutdown.** A deploy sends `SIGTERM`, waits a grace period, then kills the process. In
that window you want to: stop accepting new connections, let requests already in flight finish, then
close what they were using (queue workers, database pool). Closing the database first would fail
requests that are halfway through a query. A forced exit after 10 seconds stops a client holding a
keep-alive connection from blocking the deploy forever; `unref()` stops that timer from keeping the
process alive on its own.

**Why `app.ts` is separate.** Building the app (middleware and routes) and running it (connect,
listen, signals) are different jobs. Tests need the first without the second. Splitting them now
costs one file; splitting later means touching every route registration.

## 6. Steps

### Step 1 — Install this phase's packages

```bash
pnpm --filter api add express@^5.2.1 helmet@^8.3.0 cors@^2.8.6 cookie-parser@^1.4.7 dotenv@^17.4.2 zod@^4.6.5
pnpm --filter api add -D @types/express@^5.0.6 @types/cors@^2.8.19 @types/cookie-parser@^1.4.10
```

`cookie-parser` isn't used until Phase 06, but it's part of the standard middleware stack and
registering it now means the stack is in its final order from day one.

### Step 2 — Constants

`src/constants/http.ts` — copy `e-commerce/apps/backends/postgres/src/constants/http.ts`, change
only: add `SERVICE_UNAVAILABLE` (the health check returns it in Phase 03, and the LLM-down path in
Phase 14).

```ts
export const OK = 200;
export const CREATED = 201;
export const ACCEPTED = 202;
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const FORBIDDEN = 403;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const UNPROCESSABLE_CONTENT = 422;
export const TOO_MANY_REQUESTS = 429;
export const INTERNAL_SERVER_ERROR = 500;
// An upstream service we depend on (e.g. the LLM provider) failed or refused us.
export const BAD_GATEWAY = 502;
export const SERVICE_UNAVAILABLE = 503;

export type HttpStatusCode =
  | typeof OK
  | typeof CREATED
  | typeof ACCEPTED
  | typeof BAD_REQUEST
  | typeof UNAUTHORIZED
  | typeof FORBIDDEN
  | typeof NOT_FOUND
  | typeof CONFLICT
  | typeof UNPROCESSABLE_CONTENT
  | typeof TOO_MANY_REQUESTS
  | typeof INTERNAL_SERVER_ERROR
  | typeof BAD_GATEWAY
  | typeof SERVICE_UNAVAILABLE;
```

`src/constants/appErrorCode.ts` — copy `e-commerce/apps/backends/mongo/src/constants/appErrorCode.ts`
unchanged. Later phases add codes when they first throw them.

`src/constants/env.ts` — ADAPT `e-commerce/apps/backends/mongo/src/constants/env.ts`. Keep `getEnv`
exactly. Keep only the variables this phase reads. Later phases append theirs (including the JWT
secret checks in Phase 06).

```ts
const getEnv = (key: string, defaultValue?: string) => {
  const value = process.env[key] || defaultValue;

  if (value === undefined) {
    throw new Error(`Missing environment variable ${key}`);
  }

  return value;
};

export const PORT = getEnv("PORT", "4000");
export const NODE_ENV = getEnv("NODE_ENV");
export const CORS_ORIGIN = getEnv("CORS_ORIGIN");
```

Note the subtle behaviour you are inheriting: `process.env[key] || defaultValue` treats an **empty**
value (`JWT_SECRET=`) as missing. That is what you want for secrets: a blank line in `.env` should
fail boot, not boot with an empty key.

### Step 3 — Errors and the envelope

Copy these four files from `e-commerce/apps/backends/mongo/src/utils/errors/`, change only: add
`.js` to every relative import (NodeNext requires it; see Phase 00).

- `appError.ts` — no relative imports except `../../constants/appErrorCode` → `../../constants/appErrorCode.js`.
- `appAssert.ts` — `./appError` → `./appError.js`, `../../constants/https` → `../../constants/http.js`
  (the file is named `http.ts` here, as in the Postgres port), `../../constants/appErrorCode` →
  `../../constants/appErrorCode.js`.
- `catchError.ts` — no relative imports.
- `index.ts`:

```ts
export * from "./appError.js";
export { default as appAssert } from "./appAssert.js";
export * from "./catchError.js";
```

Copy `utils/api/apiEnvelope.ts` unchanged and `utils/api/index.ts` with the `.js` suffix:

```ts
export * from "./apiEnvelope.js";
```

### Step 4 — `notFound` and `errorHandler`

`src/middleware/notFound.ts` — copy, change only the import paths:

```ts
import type { Request, Response } from "express";
import { NOT_FOUND } from "../constants/http.js";
import { fail } from "../utils/api/index.js";

export function notFound(req: Request, res: Response) {
  res
    .status(NOT_FOUND)
    .json(fail(`Route not Found: ${req.method} ${req.originalUrl}`));
}
```

`src/middleware/errorHandler.ts` — ADAPT. Changes from e-commerce:

1. The Zod branch returns the **full envelope** (`status`, `data`, `errors`). e-commerce returns
   only `{ errors }`, so a client checking `body.status` gets `undefined` for exactly the errors it
   most needs to show.
2. The two Multer branches are removed (no uploads in this project).
3. The refresh-cookie clearing branch is removed for now; Phase 07 adds it back when
   `REFRESH_PATH` exists.
4. Unknown errors are logged with `console.error` for now; Phase 02 swaps in the logger.

```ts
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors/index.js";
import { fail } from "../utils/api/index.js";
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from "../constants/http.js";

const handleZodError = (res: Response, error: ZodError) => {
  const errors = error.issues.map((issue) => ({
    message: issue.message,
    code: issue.path.join(".") || undefined,
  }));
  return res.status(BAD_REQUEST).json({ status: "error", data: null, errors });
};

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    return handleZodError(res, error);
  }

  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json(fail(error.message, error.errorCode ?? "APP_ERROR"));
  }

  console.error("error", error);
  return res
    .status(INTERNAL_SERVER_ERROR)
    .json(fail("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}
```

Why the field path goes in `code`: the envelope's error type is `{ message, code? }` (from
`apiEnvelope.ts`). Putting the field name in `code` keeps one shape for every error the client
receives; the form code maps `code` to the input that failed.

`_next` is unused but must stay: Express detects error middleware by the four parameters.

### Step 5 — `app.ts`

NEW. The middleware order is e-commerce's, minus what this project doesn't have yet (webhook, Bull
Board, visitor id, rate limiter: those arrive in their phases at the same positions).

```ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, NODE_ENV } from "./constants/env.js";
import { ok } from "./utils/api/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  // Baseline response headers. HSTS only in production, where the API is served over HTTPS.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: NODE_ENV === "production" ? undefined : false,
    }),
  );

  const corsOrigin = CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: corsOrigin, credentials: true }));

  // Chat messages are short; a small body limit stops someone posting megabytes into the LLM path.
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  // Declared before the feature routers, so a router that applies auth to everything it sees can
  // never put /health behind a login (that bug happened in e-commerce).
  app.get("/health", (_req, res) => {
    res.json(ok({ status: "ok" }));
  });

  // Feature routers are mounted here, one phase at a time.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
```

`crossOriginResourcePolicy: "cross-origin"` is needed because the widget (Phase 33) is served from a
different origin than the API and fetches from it.

### Step 6 — `index.ts`

ADAPT `e-commerce/apps/backends/mongo/src/index.ts`. Kept: `dotenv/config` first, `main()` with a
`.catch` that exits 1, listen on `0.0.0.0`, the full shutdown function (re-entrancy guard, forced
exit after 10 s, `unref`, `unhandledRejection` / `uncaughtException` routed to it). Removed: Mongo,
Bull Board, webhook, trust proxy, debug IP, route registration (now in `app.ts`). The worker and
database steps of shutdown come back in Phases 03 and 09.

```ts
import "dotenv/config";
import { PORT } from "./constants/env.js";
import { createApp } from "./app.js";

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const app = createApp();

  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server is listening on port ${PORT}`);
  });

  let shuttingDown = false;

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${reason} — closing`);

    // A client holding a keep-alive connection open shouldn't hold the deploy open with it.
    const forceExit = setTimeout(() => {
      console.error(
        "[shutdown] in-flight requests did not finish in time — exiting anyway",
      );
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      console.log("[shutdown] complete");
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] failed:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A rejection nobody handled would otherwise end the process with no context.
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled promise rejection:", reason);
    void shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    console.error("[fatal] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  console.error("[startup] failed:", error);
  process.exit(1);
});
```

Why `import "dotenv/config"` must be the **first** import: ES module imports run in order, and
`./constants/env.js` reads `process.env` the moment it's imported. If it ran before dotenv, every
variable from `.env` would be missing.

### Step 7 — Run it

```bash
pnpm --filter api dev
```

## 7. Commit points

1. `feat(api): add http constants, env validation and error utilities`
2. `feat(api): add response envelope, not-found and error handler middleware`
3. `feat(api): add express app factory with health check`
4. `feat(api): add server entry with ordered graceful shutdown`

## 8. Verify

```bash
pnpm --filter api dev
# Server is listening on port 4000

curl -s localhost:4000/health
# {"status":"success","data":{"status":"ok"}}

curl -s -i localhost:4000/nope | head -1
# HTTP/1.1 404 Not Found
curl -s localhost:4000/nope
# {"status":"error","data":null,"errors":[{"message":"Route not Found: GET /nope"}]}

# Security headers from helmet
curl -s -I localhost:4000/health | grep -i -E "x-content-type-options|x-frame-options"
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN

# Body limit: 40 KB of JSON is rejected (a 413 that becomes a 500 in our handler; see mistakes)
node -e 'console.log(JSON.stringify({x:"a".repeat(40000)}))' | \
  curl -s -o /dev/null -w "%{http_code}\n" -H 'content-type: application/json' --data-binary @- localhost:4000/health

# Boot validation: remove CORS_ORIGIN from .env and start again
pnpm --filter api dev
# Error: Missing environment variable CORS_ORIGIN   (and the process exits)

# Graceful shutdown: start the server, press Ctrl+C
# [shutdown] SIGINT — closing
# [shutdown] complete

pnpm build && node apps/api/dist/index.js   # the compiled server runs too
```

## 9. Common mistakes

- **Importing `./constants/env` before `dotenv/config`.** Every variable reads as missing and boot
  fails with a confusing "Missing environment variable PORT" even though it's in `.env`.
- **Forgetting `.js` in one import.** TS2835 at compile time. Fix the import; never switch the module
  resolution.
- **Registering `errorHandler` before the routes.** Errors bypass it and Express answers with its own
  HTML error page.
- **Removing `_next` from `errorHandler` because ESLint says it's unused.** Express then treats it
  as normal middleware and it never sees errors.
- **The oversized-body check returns 500, not 413.** `express.json` throws an error with
  `status: 413` and `type: "entity.too.large"`, which is neither a `ZodError` nor an `AppError`. That
  is acceptable for now; Phase 24 maps body-parser errors (413 and malformed JSON 400) to proper
  envelopes as part of input hardening. Write the number you actually got in your notes.
- **Using `app.listen(PORT)` with a string port.** Express accepts it but treats a non-numeric
  string as a pipe path. `Number(PORT)` makes the intent explicit.

## 10. Interview prep

**Q: Why validate environment variables at startup?**
A: So configuration errors fail the deploy instead of failing a user. Reading env lazily means a
missing secret is found by the first request that needs it. Reading everything once at import time,
and throwing, means the server either starts fully configured or doesn't start.

**Q: How do you handle errors in an Express API?**
A: Services throw a typed `AppError` (via `appAssert`) carrying a status and a code; controllers are
wrapped so rejected promises reach `next`; one error middleware, registered last, maps validation
errors to 400 with field details, `AppError` to its own status, and everything else to a generic 500
that logs the real error but never sends a stack trace to the client.

**Q: What does graceful shutdown do and why does order matter?**
A: On SIGTERM it stops accepting connections, waits for in-flight requests, then closes the things
those requests use, like workers and the database pool, and exits; a timer forces exit if something
hangs. Closing the database first would fail requests mid-query.

**Q: Why separate `createApp()` from `listen()`?**
A: Tests can build the real app with all its middleware and routes and send requests to it without
binding a fixed port or triggering process-level signal handlers.

## 11. Resume-safe claim

"Built an Express 5 TypeScript API foundation with boot-time configuration validation, a typed error
model and uniform response envelope, and ordered graceful shutdown."

## 12. Definition of done

- [ ] `/health` returns the success envelope
- [ ] An unknown route returns the 404 envelope
- [ ] Removing a required env var stops boot with a clear message
- [ ] Ctrl+C prints both shutdown lines and exits
- [ ] `pnpm build && node apps/api/dist/index.js` starts the compiled server
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] I can explain why `errorHandler` has four parameters and is registered last
