# Phase 07 — Refresh rotation, `authenticate` and `/auth/me`

## 1. Goal

Make staff sessions last 30 days safely, and protect routes.

- `GET /auth/refresh` exchanges the refresh cookie for a new access **and** refresh token. Each
  refresh token works once; presenting an old one revokes the whole session (reuse detection).
- `authenticate` middleware checks the access token **and** that its session still exists, then puts
  `req.userId` and `req.sessionId` on the request.
- `GET /auth/me` returns the signed-in staff member. The staff page (Phase 35) calls it on load.

All three are copies of the e-commerce Postgres port with small, listed changes. One deliberate
difference from the reference map: there is no `requireStaff`. Only staff have accounts, so being
authenticated already means being staff. Removing someone means deleting their user row, which
cascades to their sessions, which `authenticate` checks on every request.

## 2. What I will understand after this phase

1. What refresh-token rotation and reuse detection are, and what attack they turn into a visible
   event.
2. How one conditional `UPDATE` makes rotation safe when two tabs refresh at the same time.
3. Why there's a 30-second grace window.
4. How Express's `Request` type is extended with `userId` and `sessionId`.

## 3. Prerequisites

- Phase 06 done: login sets both cookies.

## 4. Files

```
apps/api/src/
├── types/express.d.ts              ADAPT  e-commerce/apps/backends/postgres/src/types/express.d.ts
├── services/auth.service.ts        (refreshUserAccessToken added — ADAPT from the port)
├── middleware/authenticate.ts      COPY   e-commerce/apps/backends/postgres/src/middleware/authenticate.ts
├── middleware/errorHandler.ts      (clear cookies on refresh failure — back from mongo's version)
├── constants/appErrorCode.ts       (unchanged; its codes are now used)
├── controllers/auth.controller.ts  (refreshHandler, meHandler)
└── routes/auth.route.ts            (two routes)
```

## 5. Concepts

**Rotation.** Every refresh issues a new refresh token and invalidates the old one. Each refresh
token carries a random `jti` (JWT id), and the session row stores the current one. A refresh is only
accepted if the presented `jti` equals the stored one.

**Reuse detection.** If an attacker copies a refresh token and uses it, either they or the real user
refreshes first. When the other one later presents the now-old token, the server sees a `jti` that
was already replaced — evidence that two parties hold the same token — and deletes the whole session.
Both are signed out; the real user logs in again, the attacker can't. A stolen token becomes a
detected event instead of 30 days of silent access.

**The race, and the conditional update.** Two tabs can refresh at the same moment with the same
valid token. "Read the session, compare the jti, then write" would let both pass the comparison. The
port does it as one statement: update the session **where** `id = X and refreshJti = presented`. Only
one of the two updates matches a row; the database decides the winner atomically.

**The grace window.** The losing tab presented a token that was valid a few milliseconds ago. That's
not theft, it's timing. So an old token is accepted if it was replaced less than 30 seconds ago:
the loser gets the current token instead of a revoked session. Older than that, it's treated as
reuse.

**`authenticate` checks the session, every time.** A JWT's signature only proves the server issued
it. Checking the session row means logout, a password reset from the seed script, and deleting a
staff member all take effect on the very next request. e-commerce puts a 60-second Redis cache in
front of that lookup; the port deliberately doesn't (its comment says so), and neither does this
project: staff traffic is a few requests a minute.

## 6. Steps

### Step 1 — `src/types/express.d.ts`

ADAPT the port's: no `role`. `visitorId` is added in Phase 08.

```ts
import type { Models } from "../prisma/contract.js";

declare global {
  namespace Express {
    interface Request {
      userId: Models.public_User["id"];
      sessionId: Models.public_Session["id"];
    }
  }
}

export {};
```

`export {}` makes the file a module, which TypeScript requires for `declare global`. It's picked up
because `tsconfig.json` includes everything under `src`.

### Step 2 — `refreshUserAccessToken`

Copy `refreshUserAccessToken` and `REFRESH_REUSE_GRACE_MS` from the port's `auth.service.ts` into
yours. Changes only:

- the user lookup selects `id` only (no `role`), and `signAccessToken(user.id, session.id)` matches
  Phase 06's signature
- `.js` imports: `verifyToken`, `refreshTokenVerifyOptions` from `../utils/auth/index.js`;
  `thirtyDaysFromNow` from `../utils/date/date.js`; `appErrorCode` from `../constants/appErrorCode.js`;
  `RefreshTokenPayload` from `../types/auth.types.js`

The result, so you can check your copy:

```ts
const REFRESH_REUSE_GRACE_MS = 30 * 1000;

export const refreshUserAccessToken = async (refreshToken: string) => {
  const now = Date.now();
  const { payload } = verifyToken<RefreshTokenPayload>(
    refreshToken,
    refreshTokenVerifyOptions,
  );
  appAssert(
    payload && payload.jti,
    UNAUTHORIZED,
    "Invalid refresh token",
    appErrorCode.InvalidAccessToken,
  );

  const session = await orm.Session.where({ id: payload.sessionId })
    .select("id", "userId", "expiresAt")
    .first();
  appAssert(
    session && new Date(session.expiresAt).getTime() > now,
    UNAUTHORIZED,
    "Session expired",
    appErrorCode.InvalidAccessToken,
  );

  // Rotate only if the presented token is still the current one. As one conditional update, two
  // concurrent refreshes can't both rotate.
  const newJti = crypto.randomUUID();
  const rotated = await orm.Session.where({
    id: session.id,
    refreshJti: payload.jti,
  }).update({
    refreshJti: newJti,
    prevRefreshJti: payload.jti,
    rotatedAt: new Date(now).toISOString(),
    expiresAt: thirtyDaysFromNow().toISOString(),
  });

  let currentJti: string;

  if (rotated) {
    currentJti = newJti;
  } else {
    // Lost the race, or the token is stale. Re-read to see which.
    const latest = await orm.Session.where({ id: session.id })
      .select("refreshJti", "prevRefreshJti", "rotatedAt")
      .first();
    const isRecentlyReplaced =
      latest?.refreshJti &&
      latest.prevRefreshJti === payload.jti &&
      latest.rotatedAt &&
      now - new Date(latest.rotatedAt).getTime() < REFRESH_REUSE_GRACE_MS;

    if (!isRecentlyReplaced) {
      await revokeSessions({ id: session.id });
      appAssert(
        false,
        UNAUTHORIZED,
        "Session revoked",
        appErrorCode.InvalidAccessToken,
      );
    }

    currentJti = latest!.refreshJti;
  }

  return {
    accessToken: signAccessToken(session.userId, session.id),
    newRefreshToken: signRefreshToken(session.id, currentJti),
  };
};
```

Note the expiry is extended on each refresh (`expiresAt: thirtyDaysFromNow()`): a staff member who
uses the page at least once a month stays signed in; one who doesn't is signed out.

### Step 3 — `authenticate`

Copy `e-commerce/apps/backends/postgres/src/middleware/authenticate.ts`. Changes only:

- `.js` imports (`appAssert` and `catchError` from `../utils/errors/index.js`, `verifyToken` from
  `../utils/auth/index.js`, `orm` from `../prisma/db.js`, and the others)
- remove `req.role = payload.role;`
- keep the port's comment about the session cache verbatim; it's the record of a decision

The core:

```ts
const assertSessionActive = async (
  sessionId: AccessTokenPayload["sessionId"],
) => {
  const session = await orm.Session.where({ id: sessionId })
    .where((s) => s.expiresAt.gt(new Date().toISOString()))
    .select("id")
    .first();
  appAssert(
    session,
    UNAUTHORIZED,
    "Session expired",
    appErrorCode.InvalidAccessToken,
  );
};

const authenticate = catchError(async (req, _res, next) => {
  const accessToken = req.cookies.accessToken as string | undefined;
  appAssert(
    accessToken,
    UNAUTHORIZED,
    "Not Authorized",
    appErrorCode.InvalidAccessToken,
  );

  const { error, payload } = verifyToken(accessToken);
  appAssert(
    payload,
    UNAUTHORIZED,
    error == "jwt expired" ? "Token expired" : "Invalid token",
    error == "jwt expired"
      ? appErrorCode.TokenExpired
      : appErrorCode.InvalidAccessToken,
  );

  await assertSessionActive(payload.sessionId);

  req.userId = payload.userId;
  req.sessionId = payload.sessionId;
  next();
});

export default authenticate;
```

The error code matters to the client: `TOKEN_EXPIRED` tells the staff app's Axios interceptor
(Phase 35) to call `/auth/refresh` and retry; any other 401 means "go to the login page".

### Step 4 — Clear cookies when a refresh fails

Add back the branch Phase 01 removed, from mongo's `errorHandler.ts`, **before** the `AppError`
branch:

```ts
import { clearAuthCookies, REFRESH_PATH } from "../utils/auth/index.js";
// …
if (req.path === REFRESH_PATH) {
  clearAuthCookies(res);
}
```

A refresh that fails (expired, revoked, reused) leaves the browser holding dead cookies; clearing
them stops the client from retrying a token that can never work.

`req.path` here is the full path (`/auth/refresh`) because the error handler is mounted on the app,
not inside the `/auth` router.

### Step 5 — Handlers and routes

Append to `auth.controller.ts`:

```ts
import { appAssert } from "../utils/errors/index.js";
import { NOT_FOUND, UNAUTHORIZED } from "../constants/http.js";
import { refreshUserAccessToken } from "../services/auth.service.js";
import {
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} from "../utils/auth/index.js";
import { orm } from "../prisma/db.js";

export const refreshHandler = catchError(async (req, res) => {
  const refreshToken = req.cookies.refreshToken as string | undefined;
  appAssert(refreshToken, UNAUTHORIZED, "Missing refresh token");

  const { accessToken, newRefreshToken } =
    await refreshUserAccessToken(refreshToken);

  // Refresh tokens are single-use, so a new one is issued on every refresh.
  res
    .status(OK)
    .cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions())
    .cookie("accessToken", accessToken, getAccessTokenCookieOptions())
    .json(ok({ message: "Access token refreshed" }));
});

export const meHandler = catchError(async (req, res) => {
  const user = await orm.User.where({ id: req.userId })
    .select("id", "email", "name")
    .first();
  appAssert(user, NOT_FOUND, "User not found");
  res.status(OK).json(ok({ user }));
});
```

`meHandler` reads the database directly instead of calling a service. That is the port's own
`getProfileData` pattern for a one-line read; when this read grows any logic, it moves to the service.

Routes:

```ts
import authenticate from "../middleware/authenticate.js";
// …
// GET, matching the port and the cookie's Path. The refresh cookie is only sent to this exact path.
authRoutes.get("/refresh", refreshHandler);
authRoutes.get("/me", authenticate, meHandler);
```

## 7. Commit points

1. `feat(api): add refresh token rotation with reuse detection`
2. `feat(api): add authenticate middleware with live session check`
3. `feat(api): add /auth/me and clear cookies on failed refresh`

## 8. Verify

```bash
J=/tmp/cd-cookies
curl -s -c $J -X POST localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@firm.test","password":"<your password>"}' > /dev/null

# Authenticated
curl -s -b $J localhost:4000/auth/me
# {"status":"success","data":{"user":{"id":"…","email":"ana@firm.test","name":"Ana Diaz"}}}

# No cookie
curl -s localhost:4000/auth/me
# {"status":"error","data":null,"errors":[{"message":"Not Authorized","code":"InvalidAccessToken"}]}

# Rotation: save the current refresh token, refresh, then replay the old one
OLD=$(grep refreshToken $J | awk '{print $7}')
curl -s -b $J -c $J localhost:4000/auth/refresh          # success, new cookies
sleep 31                                                   # past the grace window
curl -s -i --cookie "refreshToken=$OLD" localhost:4000/auth/refresh | grep -E "HTTP|Set-Cookie|message"
# HTTP/1.1 401 …, "Session revoked", and Set-Cookie headers clearing both cookies

# The session is gone, so even the NEW access token now fails
curl -s -b $J localhost:4000/auth/me                       # 401 Session expired

# Grace window: log in again, refresh twice quickly with the same token → both succeed
# Removal: log in, then delete the user in psql; /auth/me → 401 on the next request
```

## 9. Common mistakes

- **Rotating with a read-then-write** ("find session, compare jti, update"). Two concurrent
  refreshes both pass. The `where` on `refreshJti` inside the update is the whole point.
- **Forgetting to update the refresh cookie on refresh.** The client keeps sending the old token,
  which is now "reused", and gets signed out after the grace window.
- **Putting `authenticate` on `/auth/refresh`.** The access token is usually expired when refresh is
  called; the refresh route must authenticate by the refresh token alone.
- **Trusting the JWT without the session lookup.** Logout and staff removal stop working until the
  token expires.

## 10. Interview prep

**Q: Explain refresh token rotation and reuse detection.**
A: Each refresh token is single-use: refreshing issues a new one and records which `jti` is current.
If an already-replaced token shows up later, two parties must hold it, so the session is revoked
and everyone holding it is signed out. A 30-second grace window handles two tabs refreshing at the
same instant.

**Q: How do you make rotation safe under concurrency?**
A: One conditional update filtered on the session id and the presented `jti`. Only one concurrent
request can match the row; the loser re-reads and gets the grace-window path.

**Q: Why check the session on every request? Isn't that what JWTs avoid?**
A: It's what makes revocation immediate. For a low-traffic staff app the extra indexed lookup costs
nothing measurable; at high traffic I'd cache the "session is active" answer for a short TTL, as I
did in an earlier project, and invalidate it in the one function that revokes sessions.

## 11. Resume-safe claim

"Built refresh-token rotation with reuse detection, made race-safe with a single conditional update,
and session-backed authentication enabling immediate revocation."

## 12. Definition of done

- [ ] `/auth/me` works with cookies and returns 401 without them
- [ ] A refresh rotates both cookies
- [ ] Replaying an old refresh token after 30 s revokes the session and clears cookies
- [ ] Two quick refreshes with the same token both succeed (grace window)
- [ ] Deleting a user makes their next request fail
- [ ] Typecheck and lint pass
