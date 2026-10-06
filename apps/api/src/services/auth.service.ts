import crypto from "node:crypto";
import type { StaffLogin } from "@repo/types";
import { orm } from "../prisma/db.js";
import type { Models } from "../prisma/contract.js";
import { appAssert } from "../utils/errors/index.js";
import { UNAUTHORIZED } from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import {
  compareValue,
  hashValue,
  refreshTokenSignOptions,
  refreshTokenVerifyOptions,
  signToken,
  verifyToken,
} from "../utils/auth/index.js";
import { thirtyDaysFromNow } from "../utils/date/date.js";
import type { RefreshTokenPayload } from "../types/auth.types.js";

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
