import type { Request } from "express";
import {
  createDualRateLimiter,
  createRateLimiter,
} from "../middleware/rateLimiter.js";
import { extractClientIp } from "../utils/rateLimiter/ipExtractor.js";
import {
  AUTH_FORGOT_ACCOUNT_PREFIX,
  AUTH_FORGOT_PREFIX,
  AUTH_FORGOT_SOURCE_PREFIX,
  AUTH_LOGIN_ACCOUNT_PREFIX,
  AUTH_LOGIN_PREFIX,
  AUTH_LOGIN_SOURCE_PREFIX,
  AUTH_REFRESH_PREFIX,
  AUTH_REFRESH_SOURCE_PREFIX,
  AUTH_RESET_SOURCE_PREFIX,
  CHAT_DAILY_PREFIX,
  CHAT_IP_PREFIX,
  CHAT_VISITOR_PREFIX,
  FIFTEEN_MINUTES_MS,
  FIVE_MINUTES_MS,
  GLOBAL_IP_PREFIX,
  GLOBAL_VISITOR_PREFIX,
  ONE_DAY_MS,
  STAFF_API_PREFIX,
  TEN_MINUTES_MS,
  THIRTY_MINUTES_MS,
} from "../constants/rateLimiter.constant.js";
import { refreshTokenVerifyOptions, verifyToken } from "../utils/auth/index.js";
import type { RefreshTokenPayload } from "../types/auth.types.js";

/*
  Key Resolvers
 */
const ipAndEmailKeyResolver = (req: Request): string => {
  const ip = extractClientIp(req);
  return `ip:${ip}:email:${emailKeyPart(req)}`;
};

// The account being tried, independent of where the attempt came from.
const emailKeyPart = (req: Request): string =>
  req.body && typeof req.body === "object" && "email" in req.body
    ? String((req.body as { email?: unknown }).email ?? "")
        .toLowerCase()
        .trim()
    : "anonymous";

const emailKeyResolver = (req: Request): string => `email:${emailKeyPart(req)}`;

const ipKeyResolver = (req: Request): string => `ip:${extractClientIp(req)}`;

export const visitorKeyResolver = (req: Request): string => {
  return (
    req.visitorId || (req.cookies?.visitorId as string) || extractClientIp(req)
  );
};

/*
  The session a refresh cookie belongs to, so every signed-in user gets their own refresh budget
  instead of sharing one per IP — behind an office NAT or carrier-grade NAT, an IP-keyed budget ran
  out and the client then signed out everyone on that address. Verifying is a single HMAC, so it's
  cheap; a missing or forged cookie falls back to the IP.
 */
const refreshSessionKeyResolver = (req: Request): string => {
  const refreshToken = req.cookies?.refreshToken;
  if (typeof refreshToken === "string") {
    const { payload } = verifyToken<RefreshTokenPayload>(
      refreshToken,
      refreshTokenVerifyOptions,
    );
    if (payload?.sessionId) {
      return `session:${payload.sessionId}`;
    }
  }
  return `ip:${extractClientIp(req)}`;
};

/*
  1. Global Infrastructure Protection (Atomic Dual-Bucket)
  Runs pre-auth across all incoming requests.
  Evaluates both:
  - Anonymous browser fairness: 500 requests / 5 minutes
  - Aggregate IP flood defense: 2000 requests / 5 minutes
 */
export const globalLimiter = createDualRateLimiter({
  visitorPrefix: GLOBAL_VISITOR_PREFIX,
  ipPrefix: GLOBAL_IP_PREFIX,
  windowMs: FIVE_MINUTES_MS,
  visitorLimit: 500,
  ipLimit: 2000,
  visitorKeyResolver: (req: Request) => visitorKeyResolver(req),
  ipKeyResolver: (req: Request) => extractClientIp(req),
});

/*
  2. Authentication Limiters
  Security-sensitive; applies punitive temporary lockouts to the specific ip:email key.
 */
export const loginLimiter = createRateLimiter({
  prefix: AUTH_LOGIN_PREFIX,
  windowMs: FIVE_MINUTES_MS,
  blockDurationMs: THIRTY_MINUTES_MS,
  max: 10,
  keyResolver: ipAndEmailKeyResolver,
});

/*
  The pair above is one axis of three, and on its own it stops neither shape of credential attack:
  spread one account across many sources and no pair fills up; walk a list of accounts from one
  source and, again, no pair fills up. These two cover those axes — an account is locked however
  many places the guesses come from, and a source is capped however many accounts it tries.
  All three run on the login route; the first to reject wins.
*/
/*
  Not punitive on purpose. This key is only the email, which anyone can type, so a lockout here let
  anyone lock any user out for 30 minutes at a time with 15 bad guesses. As a plain sliding window it
  still caps guesses against one account, but the real user regains access as soon as the window
  moves on, and an attacker can't extend a lock.
*/
export const loginAccountLimiter = createRateLimiter({
  prefix: AUTH_LOGIN_ACCOUNT_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 15,
  keyResolver: emailKeyResolver,
});

// Deliberately loose: a household or office behind one NAT address shares it, so this is sized to
// catch account enumeration rather than to police normal shared use.
export const loginSourceLimiter = createRateLimiter({
  prefix: AUTH_LOGIN_SOURCE_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 50,
  keyResolver: ipKeyResolver,
});

/*
  Forgot password. Each accepted request sends an email, so unlike login these protect other people's
  inboxes (and the mail quota), not the account. The same three axes as login. All answer 429 for
  unknown addresses exactly as for real ones, so the limit itself reveals nothing.
 */
// Non-punitive for the same reason as loginAccountLimiter: the key is only an email anyone can type.
export const forgotAccountLimiter = createRateLimiter({
  prefix: AUTH_FORGOT_ACCOUNT_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 3,
  keyResolver: emailKeyResolver,
});

export const forgotLimiter = createRateLimiter({
  prefix: AUTH_FORGOT_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 5,
  keyResolver: ipAndEmailKeyResolver,
});

export const forgotSourceLimiter = createRateLimiter({
  prefix: AUTH_FORGOT_SOURCE_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 20,
  keyResolver: ipKeyResolver,
});

// Links are unguessable, so this only stops a source hammering the endpoint.
export const resetSourceLimiter = createRateLimiter({
  prefix: AUTH_RESET_SOURCE_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 30,
  keyResolver: ipKeyResolver,
});

export const refreshTokenLimiter = createRateLimiter({
  prefix: AUTH_REFRESH_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 20,
  keyResolver: refreshSessionKeyResolver,
});

// Loose on purpose: sized for many signed-in users behind one address, it only stops a single source
// hammering the endpoint with forged or rotating cookies.
export const refreshTokenSourceLimiter = createRateLimiter({
  prefix: AUTH_REFRESH_SOURCE_PREFIX,
  windowMs: FIFTEEN_MINUTES_MS,
  max: 300,
  keyResolver: ipKeyResolver,
});

/*
  Chat. Every message costs several model calls, so these limits protect quota and money, not the
  server. A real conversation is a message every few seconds at most; 20 per 10 minutes per browser
  is far above that. The IP bucket is looser because an office or household shares one address.
 */
export const chatLimiter = createDualRateLimiter({
  visitorPrefix: CHAT_VISITOR_PREFIX,
  ipPrefix: CHAT_IP_PREFIX,
  windowMs: TEN_MINUTES_MS,
  visitorLimit: 20,
  ipLimit: 60,
  visitorKeyResolver: (req: Request) => visitorKeyResolver(req),
  ipKeyResolver: (req: Request) => extractClientIp(req),
});

// A patient script stays under the 10-minute limit forever; this caps a browser's whole day.
export const chatDailyLimiter = createRateLimiter({
  prefix: CHAT_DAILY_PREFIX,
  windowMs: ONE_DAY_MS,
  max: 100,
  keyResolver: (req: Request) => `guest:${visitorKeyResolver(req)}`,
});

// Staff API limiter: 300 requests per 5 minutes per staff user. Keyed by req.userId after authenticate.
export const staffApiLimiter = createRateLimiter({
  prefix: STAFF_API_PREFIX,
  windowMs: FIVE_MINUTES_MS,
  max: 300,
  keyResolver: (req: Request) => `user:${req.userId || extractClientIp(req)}`,
});
