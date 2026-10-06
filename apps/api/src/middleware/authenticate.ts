import { appAssert, catchError } from "../utils/errors/index.js";
import { UNAUTHORIZED } from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import { verifyToken } from "../utils/auth/index.js";
import { orm } from "../prisma/db.js";
import type { AccessTokenPayload } from "../types/auth.types.js";

/*
  A valid signature only proves the token was issued, not that its session is still alive. Without
  the session lookup, logout, password reset, password change and "sign out this device" left the
  access token working for up to its full 15 minutes. The signature is checked first, so forged or
  malformed tokens never reach the database.
 */
/*
  No session cache yet — every request hits Postgres. The mongo backend fronts this check with a
  60s Redis cache (see its `authenticate.ts`); porting that is deferred until the caching layer
  exists here, so don't add one ad hoc in this file.
 */
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
