# Phase 06 — Staff accounts: login and logout

## 1. Goal

Let law-firm staff sign in. Staff accounts are created by a seed script (there is no public sign-up:
visitors never have accounts). Login checks the password, creates a server-side session, and sets
two httpOnly cookies: a 15-minute access token and a 30-day refresh token. Logout deletes the
session.

This is the e-commerce auth, cut down to what the spec needs. **Kept:** bcrypt with 12 rounds and
the dummy-hash comparison that hides which emails exist, HS256 JWTs with separate secrets and
audiences, server-side sessions, `revokeSessions` as the single way to end sessions, and the
boot-time secret checks. **Dropped:** registration, email verification, password reset, Google
sign-in, avatars, roles.

## 2. What I will understand after this phase

1. Why passwords are hashed with bcrypt and what the "dummy hash" defends against.
2. Why tokens live in httpOnly cookies and what `Secure` and `SameSite` do.
3. Why there are two tokens with different lifetimes, secrets and audiences.
4. Why a JWT alone isn't enough, and what the session row adds.
5. How a seed script creates the first account safely.

## 3. Prerequisites

- Phase 05 done.
- Two secrets in `apps/api/.env`, generated with `openssl rand -hex 32` (run it twice; they must
  differ).

## 4. Files

```
packages/types/src/
├── auth.ts                          ADAPT  e-commerce/packages/types/src/user.ts (email field + login schema)
└── index.ts                         (export it)
apps/api/
├── package.json                     (bcrypt, jsonwebtoken; seed:staff script)
└── src/
    ├── prisma/contract.prisma       (User, Session)
    ├── constants/env.ts             (JWT secrets + checks)
    ├── types/auth.types.ts          ADAPT  e-commerce/apps/backends/postgres/src/types/auth.types.ts
    ├── utils/date/date.ts           COPY   e-commerce/apps/backends/postgres/src/utils/date/date.ts
    ├── utils/auth/bcrypt.ts         COPY   e-commerce/apps/backends/postgres/src/utils/auth/bcrypt.ts
    ├── utils/auth/jwt.ts            ADAPT  e-commerce/apps/backends/postgres/src/utils/auth/jwt.ts
    ├── utils/auth/cookies.ts        ADAPT  e-commerce/apps/backends/mongo/src/utils/auth/cookies.ts
    ├── utils/auth/index.ts          NEW    (barrel, mongo style)
    ├── services/auth.service.ts     ADAPT  e-commerce/apps/backends/postgres/src/services/auth.service.ts
    ├── controllers/auth.controller.ts ADAPT e-commerce/apps/backends/postgres/src/controllers/auth.controller.ts
    ├── routes/auth.route.ts         ADAPT  e-commerce/apps/backends/postgres/src/routes/auth.route.ts
    ├── scripts/seed-staff.ts        NEW
    └── app.ts                       (mount /auth)
```

## 5. Concepts

**bcrypt.** A deliberately slow password hash with a per-password salt. "12 rounds" means 2^12
iterations: a login takes a fraction of a second, but an attacker who steals the table can only try a
few guesses per second per core, instead of billions with a fast hash like SHA-256. bcrypt only reads
the first 72 bytes of a password.

**The dummy hash.** If an unknown email returned instantly while a known one took 250 ms to run
bcrypt, an attacker could find valid staff emails by timing the login form. So an unknown email still
runs a bcrypt comparison, against a throwaway hash, and fails at the same speed.

**httpOnly cookies.** JavaScript on the page can't read an httpOnly cookie, so a cross-site scripting
bug can't steal the token. `Secure` means only over HTTPS. `SameSite` controls whether the browser
sends the cookie on requests from other sites: in production the staff page (Vercel) and the API
(Render) are on **different sites**, so the cookies must be `SameSite=None` (which browsers only
accept with `Secure`). Locally both are `localhost`, one site, so `Lax` works. This is e-commerce's
mongo backend logic; the Postgres port changed it to `Strict`, which would break a cross-site deploy.

**Two tokens.** The access token (15 min) goes with every request; if one leaks, it's useful
briefly. The refresh token (30 days) is sent only to `/auth/refresh` — its cookie `path` is
restricted to that URL — and exchanges itself for a new pair (Phase 07). Separate secrets **and**
separate audiences (`aud: "access"` vs `"refresh"`) mean neither token can be accepted as the other,
and the algorithm is pinned to HS256 on both sign and verify.

**Server-side sessions.** A signed JWT is valid until it expires, whatever happens. The session row
makes logout real: the token carries a `sessionId`, and Phase 07's `authenticate` checks the row
still exists. Delete the row, and the token stops working on the next request.

**Seeding instead of sign-up.** A public "create staff account" endpoint is a door anyone could walk
through. A script that only someone with database access can run is the smallest safe way to create
the first account. It also doubles as the password-reset path for a demo.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter api add bcrypt@^6.0.0 jsonwebtoken@^9.0.3
pnpm --filter api add -D @types/bcrypt@^6.0.0 @types/jsonwebtoken@^9.0.10
```

### Step 2 — Shared login schema

`packages/types/src/auth.ts` — ADAPT from `e-commerce/packages/types/src/user.ts`: keep the
`emailField` (trimmed, lowercased) and the login schema; drop everything about registration.

```ts
import { z } from "zod";

// Trimmed and lowercased, so "Ana@Firm.com" and "ana@firm.com" are the same account.
const emailField = z.string().trim().toLowerCase().email().max(255);

export const staffLoginSchema = z.object({
  email: emailField,
  // Login checks only presence; strength rules belong to setting a password (the seed script).
  password: z.string().min(1, { message: "Password is required" }).max(255),
});

export type StaffLogin = z.infer<typeof staffLoginSchema>;
```

`packages/types/src/index.ts`:

```ts
export * from "./common.js";
export * from "./auth.js";
```

e-commerce's `CookieParams` type lived in `@repo/types` and imported Express's `Response` type,
making the shared package depend on Express. It goes in the API instead (Step 5).

### Step 3 — Contract: `User` and `Session`

```prisma
model User {
    id           Uuid              @id @default(uuid())
    email        String            @unique
    name         String
    passwordHash String
    createdAt    TimestamptzString @default(now())
    sessions     Session[]
}

// Copied from the e-commerce port's Session model unchanged.
model Session {
    id             Uuid               @id @default(uuid())
    userId         Uuid
    userAgent      String?
    createdAt      TimestamptzString  @default(now())
    expiresAt      TimestamptzString  @default(dbgenerated("(CURRENT_TIMESTAMP + '30 days'::interval)"))
    refreshJti     String
    prevRefreshJti String?
    rotatedAt      TimestamptzString?
    user           User               @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@index([userId])
    @@index([expiresAt])
}
```

`onDelete: Cascade` on the session is how a staff member is removed: delete the user, every session
goes with it, and their next request is refused (Phase 07).

```bash
cd apps/api && pnpm db:plan add_staff_auth && pnpm db:sql && pnpm db:migrate && pnpm db:verify
```

### Step 4 — Secrets in `env.ts`

Copy these lines and the two checks from `e-commerce/apps/backends/mongo/src/constants/env.ts`
unchanged, comment included:

```ts
export const JWT_SECRET = getEnv("JWT_SECRET");
export const JWT_REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET");

/*
  HS256 secrets are only as strong as their entropy: a short or guessable one can be brute-forced
  offline from any single token, after which anyone can mint tokens for any user. The two must also
  differ, or a refresh token would verify as an access token.
 */
const MIN_JWT_SECRET_LENGTH = 32;

if (
  JWT_SECRET.length < MIN_JWT_SECRET_LENGTH ||
  JWT_REFRESH_SECRET.length < MIN_JWT_SECRET_LENGTH
) {
  throw new Error(
    `JWT_SECRET and JWT_REFRESH_SECRET must each be at least ${MIN_JWT_SECRET_LENGTH} characters (generate with: openssl rand -hex 32)`,
  );
}

if (JWT_SECRET === JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different values");
}
```

### Step 5 — Types

`src/types/auth.types.ts` — ADAPT the port's: no `role` in the access token (there are no roles),
and `CookieParams` moves here.

```ts
import type { Response } from "express";
import type { Models } from "../prisma/contract.js";

export type AccessTokenPayload = {
  userId: Models.public_User["id"];
  sessionId: Models.public_Session["id"];
};

export type RefreshTokenPayload = {
  sessionId: Models.public_Session["id"];
  jti: string;
};

export type CookieParams = {
  res: Response;
  accessToken: string;
  refreshToken: string;
};
```

`Models.public_User` is the row type the emitted `contract.d.ts` exports, the same way the port
uses it.

### Step 6 — Auth utilities

- `src/utils/date/date.ts` — COPY the port's file unchanged.
- `src/utils/auth/bcrypt.ts` — COPY the port's file unchanged.
- `src/utils/auth/jwt.ts` — COPY the port's file, change only: `.js` import suffixes
  (`../../constants/env.js`, `../../types/auth.types.js`). It already has everything: pinned HS256,
  per-token audience and secret, `signToken`, `verifyToken` (returns `{ payload }` or `{ error }`
  instead of throwing) and `verifyAccessTokenIgnoringExpiry`, which logout needs to find the session
  of an access token that has already expired.
- `src/utils/auth/cookies.ts` — ADAPT the **mongo** version (cross-site aware). Changes: `.js`
  imports, `CookieParams` from the local types.

```ts
import type { CookieOptions, Response } from "express";
import { NODE_ENV } from "../../constants/env.js";
import { fifteenMinutesFromNow, thirtyDaysFromNow } from "../date/date.js";
import type { CookieParams } from "../../types/auth.types.js";

const secure = NODE_ENV !== "development";
export const REFRESH_PATH = "/auth/refresh";

const defaults: CookieOptions = {
  // "none" lets the staff page on Vercel send these to the API on Render (different sites), but
  // browsers drop SameSite=None cookies that aren't Secure. Locally both are one site, so "lax".
  sameSite: secure ? "none" : "lax",
  httpOnly: true,
  secure,
};

export const getAccessTokenCookieOptions = (): CookieOptions => ({
  ...defaults,
  expires: fifteenMinutesFromNow(),
});

export const getRefreshTokenCookieOptions = (): CookieOptions => ({
  ...defaults,
  expires: thirtyDaysFromNow(),
  path: REFRESH_PATH,
});

export const setAuthCookies = ({
  res,
  accessToken,
  refreshToken,
}: CookieParams) =>
  res
    .cookie("accessToken", accessToken, getAccessTokenCookieOptions())
    .cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

export const clearAuthCookies = (res: Response) =>
  res
    .clearCookie("accessToken", defaults)
    .clearCookie("refreshToken", { ...defaults, path: REFRESH_PATH });
```

`clearCookie` must get the same `path`, `sameSite` and `secure` as when the cookie was set, or the
browser treats it as a different cookie and keeps the old one. (The port's version clears the access
cookie without `defaults`, which can fail in production.)

`src/utils/auth/index.ts`:

```ts
export * from "./bcrypt.js";
export * from "./jwt.js";
export * from "./cookies.js";
```

### Step 7 — `services/auth.service.ts`

ADAPT the port's service. Kept verbatim in logic: `dummyPasswordHash`, `signAccessToken`,
`signRefreshToken`, `createSessionAndTokens`, `revokeSessions`, `loginUser`. Removed: everything about
verification, reset, profile, avatar and `omitPassword`'s use (the service returns only safe fields).
`refreshUserAccessToken` is added in Phase 07.

```ts
import crypto from "node:crypto";
import type { StaffLogin } from "@repo/types";
import { orm } from "../prisma/db.js";
import type { Models } from "../prisma/contract.js";
import { appAssert } from "../utils/errors/index.js";
import { UNAUTHORIZED } from "../constants/http.js";
import {
  compareValue,
  hashValue,
  refreshTokenSignOptions,
  signToken,
} from "../utils/auth/index.js";

// Unknown emails are compared against this, so they fail exactly as slowly as a wrong password.
const dummyPasswordHash = hashValue(crypto.randomBytes(32).toString("hex"));

const signAccessToken = (
  userId: Models.public_User["id"],
  sessionId: Models.public_Session["id"],
) => signToken({ userId, sessionId });

const signRefreshToken = (
  sessionId: Models.public_Session["id"],
  jti: string,
) => signToken({ sessionId, jti }, refreshTokenSignOptions);

export const createSessionAndTokens = async (
  userId: Models.public_User["id"],
  userAgent?: string,
) => {
  const refreshJti = crypto.randomUUID();
  const session = await orm.Session.create({ userId, userAgent, refreshJti });

  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken: signRefreshToken(session.id, refreshJti),
  };
};

// The one path that ends sessions. Phase 07's authenticate relies on every revocation going through
// here, so a revoked session can't keep working.
export const revokeSessions = async (
  filter: Parameters<typeof orm.Session.where>[0],
) => {
  const sessions = await orm.Session.where(filter).select("id").all();
  if (sessions.length === 0) return 0;

  const ids = sessions.map((s) => s.id);
  await orm.Session.where((s) => s.id.in(ids)).deleteAll();
  return ids.length;
};

export const loginUser = async (
  { email, password }: StaffLogin,
  userAgent?: string,
) => {
  const user = await orm.User.where({ email }).first();

  const isValid = user
    ? await compareValue(password, user.passwordHash)
    : await compareValue(password, await dummyPasswordHash).then(() => false);

  appAssert(user && isValid, UNAUTHORIZED, "Invalid email or password");

  // Expired sessions are never read again; tidy this user's on each login instead of a cron job.
  await orm.Session.where({ userId: user.id })
    .where((s) => s.expiresAt.lt(new Date().toISOString()))
    .deleteAll();

  const { accessToken, refreshToken } = await createSessionAndTokens(
    user.id,
    userAgent,
  );

  return {
    user: { id: user.id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  };
};
```

Why the same message for "no such user" and "wrong password": a different message would tell an
attacker which emails are staff accounts, undoing the dummy hash.

Mongo's TTL index deleted expired sessions automatically; Postgres has no TTL, and the port's plan
listed a scheduled cleanup job for it. With a handful of staff, deleting a user's expired sessions
when they log in is enough and needs no scheduler.

### Step 8 — Controller and route

`src/controllers/auth.controller.ts` — ADAPT the port's `loginHandler` and `logoutHandler`:

```ts
import { staffLoginSchema } from "@repo/types";
import { catchError } from "../utils/errors/index.js";
import { OK } from "../constants/http.js";
import { ok } from "../utils/api/index.js";
import { loginUser, revokeSessions } from "../services/auth.service.js";
import {
  clearAuthCookies,
  setAuthCookies,
  verifyAccessTokenIgnoringExpiry,
} from "../utils/auth/index.js";

export const loginHandler = catchError(async (req, res) => {
  const request = staffLoginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await loginUser(
    request,
    req.headers["user-agent"],
  );

  setAuthCookies({ res, accessToken, refreshToken })
    .status(OK)
    .json(ok({ user }));
});

export const logoutHandler = catchError(async (req, res) => {
  const accessToken = req.cookies.accessToken as string | undefined;
  // An expired access token still identifies the session to delete.
  const { payload } = accessToken
    ? verifyAccessTokenIgnoringExpiry(accessToken)
    : {};
  if (payload) {
    await revokeSessions({ id: payload.sessionId });
  }

  clearAuthCookies(res)
    .status(OK)
    .json(ok({ message: "Logged out" }));
});
```

`src/routes/auth.route.ts`:

```ts
import { Router } from "express";
import { loginHandler, logoutHandler } from "../controllers/auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/login", loginHandler);
// POST, not the port's GET: logging out changes state, and a GET can be triggered by an <img> tag.
authRoutes.post("/logout", logoutHandler);
```

In `app.ts`, after `/health`:

```ts
import { authRoutes } from "./routes/auth.route.js";
// …
app.use("/auth", authRoutes);
```

### Step 9 — `scripts/seed-staff.ts`

```ts
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { hashValue } from "../utils/auth/index.js";

// Creates a staff account, or resets its password if the email already exists.
// Usage: pnpm --filter api seed:staff --email ana@firm.test --name "Ana Diaz"
const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});

const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();

if (!email || !name) {
  console.error(
    'Usage: pnpm --filter api seed:staff --email <email> --name "<name>"',
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password (min 12 characters): ");
rl.close();

if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
  console.error(
    "Password must be 12–72 bytes (bcrypt reads only the first 72).",
  );
  process.exit(1);
}

const passwordHash = await hashValue(password);
const existing = await orm.User.where({ email }).select("id").first();

if (existing) {
  await orm.User.where({ id: existing.id }).update({ name, passwordHash });
  // A password change ends every session, the same as the e-commerce reset flow.
  await orm.Session.where({ userId: existing.id }).deleteAll();
  console.log(`Updated ${email} and signed out its sessions.`);
} else {
  await orm.User.create({ email, name, passwordHash });
  console.log(`Created staff account ${email}.`);
}

await closeDB();
```

- Scripts use `console`, not the logger: they talk to a person at a terminal.
- `closeDB()` at the end, or the open pool keeps the script running forever (Phase 03).
- The password is typed at a prompt, not passed as an argument, so it doesn't land in shell history.
  (It is visible on screen while typing; hiding input needs more terminal handling than a demo
  seed script deserves.)
- The session deletion on password reset uses `orm.Session` directly rather than `revokeSessions`:
  importing the service would also import `env.ts`'s JWT checks, which is fine here, but a script
  should depend on as little as possible. Phase 07 explains why `revokeSessions` will become the
  only allowed path inside the API.

`package.json` script:

```json
"seed:staff": "tsx src/scripts/seed-staff.ts"
```

Top-level `await` works because the package is ESM.

## 7. Commit points

1. `feat(types): add staff login schema`
2. `feat(db): add staff user and session tables`
3. `feat(api): add jwt, cookie and bcrypt utilities`
4. `feat(api): add staff login and logout`
5. `feat(api): add staff seed script`

## 8. Verify

```bash
pnpm --filter api seed:staff --email ana@firm.test --name "Ana Diaz"
# Password (min 12 characters): ************
# Created staff account ana@firm.test.

# Wrong password and unknown email: same status, same message
curl -s -X POST localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@firm.test","password":"wrong"}'
curl -s -X POST localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"nobody@firm.test","password":"wrong"}'
# both: {"status":"error","data":null,"errors":[{"message":"Invalid email or password","code":"APP_ERROR"}]}

# Timing: both take roughly the same time (bcrypt runs either way)
time curl -s -o /dev/null -X POST localhost:4000/auth/login -H 'content-type: application/json' -d '{"email":"nobody@firm.test","password":"x"}'

# Valid login: two cookies
curl -s -i -c /tmp/cd-cookies -X POST localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"ANA@firm.test","password":"<your password>"}'
# Set-Cookie: accessToken=…; Path=/; Expires=…; HttpOnly; SameSite=Lax
# Set-Cookie: refreshToken=…; Path=/auth/refresh; Expires=…; HttpOnly; SameSite=Lax
# {"status":"success","data":{"user":{"id":"…","email":"ana@firm.test","name":"Ana Diaz"}}}

# Validation: missing password → 400 with the field in `code`
curl -s -X POST localhost:4000/auth/login -H 'content-type: application/json' -d '{"email":"ana@firm.test"}'

# A session row exists
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c 'SELECT id, "userAgent" FROM session;'

# Logout deletes it and clears the cookies
curl -s -i -b /tmp/cd-cookies -X POST localhost:4000/auth/logout
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c 'SELECT count(*) FROM session;'   # 0

# Boot checks: set JWT_REFRESH_SECRET equal to JWT_SECRET → server refuses to start
```

## 9. Common mistakes

- **Different error messages for unknown email vs wrong password.** Enumerates staff accounts.
- **`SameSite=Strict` or `Lax` in production.** The cross-site staff page silently stops sending the
  cookies, and every request returns 401 with no obvious cause.
- **Clearing a cookie with different options than it was set with.** The browser keeps it.
- **Storing the refresh token in `localStorage`.** Any XSS can read it. Cookies + httpOnly only.
- **Forgetting `closeDB()` in the seed script.** It prints success and never exits.
- **Putting the password in the command line.** It ends up in shell history and `ps` output.

## 10. Interview prep

**Q: How do you store passwords?**
A: bcrypt at 12 rounds, which makes each guess slow for anyone who steals the hashes. Inputs over 72
bytes are rejected because bcrypt would silently ignore the rest.

**Q: How do you avoid leaking which emails have accounts?**
A: The same error message for both cases, and an unknown email still runs a bcrypt comparison
against a dummy hash, so the response time doesn't differ either.

**Q: Why httpOnly cookies rather than a token in localStorage?**
A: Script on the page can't read an httpOnly cookie, so an XSS bug can't exfiltrate the token. The
trade-off is CSRF exposure, which `SameSite`, POST-only state changes and CORS restricted to known
origins address.

**Q: Why server-side sessions with JWTs?**
A: A JWT alone can't be revoked before expiry. Keeping a session row that each request checks makes
logout and account removal take effect immediately.

## 11. Resume-safe claim

"Implemented staff authentication with bcrypt, short-lived access and rotating refresh JWTs in
httpOnly cookies, and server-side sessions for immediate revocation."

## 12. Definition of done

- [ ] `seed:staff` creates an account and resets the password on a second run
- [ ] Wrong password and unknown email return the identical response
- [ ] Login sets both cookies with the documented attributes; the refresh cookie's path is `/auth/refresh`
- [ ] Logout deletes the session row and clears both cookies
- [ ] The server refuses to start with short or identical JWT secrets
- [ ] Typecheck and lint pass
