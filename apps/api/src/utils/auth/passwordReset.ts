import crypto from "node:crypto";
import { JWT_SECRET } from "../../constants/env.js";

/*
  Password-reset links are bearer credentials, so nothing about them is stored. A link is
  `<userId>.<issuedAt>.<signature>`, where the signature is an HMAC over the user id, the issue time
  and the user's CURRENT password hash:

  - Single use: setting a new password changes the hash, so every link issued before it stops
    verifying. The reset itself swaps the hash with a compare-and-swap, so two simultaneous clicks
    cannot both succeed.
  - Short-lived: the issue time is signed, and links older than RESET_TOKEN_TTL_MS are refused.
  - Nothing to leak: a database or Redis dump holds no token, and without the server secret (and the
    hash) a link cannot be forged.

  The signing key is derived from JWT_SECRET with a purpose label, so it can never be confused with
  the key that signs sessions.
 */
export const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
// A clock a few seconds ahead of the one that issued the link is not an attack.
const CLOCK_SKEW_MS = 30 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const signingKey = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("counseldesk:password-reset:v1")
  .digest();

const sign = (userId: string, issuedAt: number, passwordHash: string) =>
  crypto
    .createHmac("sha256", signingKey)
    .update(`${userId}:${issuedAt}:${passwordHash}`)
    .digest("base64url");

export const createPasswordResetToken = (
  userId: string,
  passwordHash: string,
  issuedAt: number,
) => `${userId}.${issuedAt}.${sign(userId, issuedAt, passwordHash)}`;

/**
 * Splits a link into its parts without trusting any of them: the shape and age are checked here,
 * the signature in {@link isValidPasswordResetSignature} once the user's hash is known.
 */
export const parsePasswordResetToken = (token: string) => {
  const [userId, issuedAtText, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !userId || !issuedAtText || !signature) return null;
  if (!UUID.test(userId) || !/^\d{1,16}$/.test(issuedAtText)) return null;

  const issuedAt = Number(issuedAtText);
  const age = Date.now() - issuedAt;
  if (age > RESET_TOKEN_TTL_MS || age < -CLOCK_SKEW_MS) return null;

  return { userId, issuedAt, signature };
};

export const isValidPasswordResetSignature = (
  parsed: { userId: string; issuedAt: number; signature: string },
  passwordHash: string,
) => {
  const expected = Buffer.from(
    sign(parsed.userId, parsed.issuedAt, passwordHash),
  );
  const actual = Buffer.from(parsed.signature);
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
};
