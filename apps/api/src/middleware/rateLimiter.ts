import type { RequestHandler, Request, Response, NextFunction } from "express";
import {
  RateLimiterAlgorithm,
  type RateLimiterOptions,
  type DualRateLimiterOptions,
  type RateLimiterStore,
} from "../types/rateLimiter.types.js";
import { TOO_MANY_REQUESTS } from "../constants/http.js";
import { extractClientIp } from "../utils/rateLimiter/ipExtractor.js";
import { RedisRateLimiterStore } from "../utils/rateLimiter/redisStore.js";
import {
  DEFAULT_KEY_PREFIX,
  GLOBAL_VISITOR_PREFIX,
  GLOBAL_IP_PREFIX,
  HTTP_HEADERS,
} from "../constants/rateLimiter.constant.js";
import { fail } from "../utils/api/index.js";
import { catchError } from "../utils/errors/index.js";

let defaultStore: RateLimiterStore | null = null;

export function getDefaultStore(): RateLimiterStore {
  if (!defaultStore) {
    defaultStore = new RedisRateLimiterStore();
  }
  return defaultStore;
}

/**
 * Creates an atomic dual-bucket rate limiter middleware.
 * Simultaneously evaluates an individual browser visitor bucket and an aggregate IP pool.
 * If either threshold is exceeded, neither bucket is committed.
 */
export function createDualRateLimiter(
  options: DualRateLimiterOptions,
): RequestHandler {
  const visitorPrefix = options.visitorPrefix || GLOBAL_VISITOR_PREFIX;
  const ipPrefix = options.ipPrefix || GLOBAL_IP_PREFIX;
  const windowMs = options.windowMs;
  const store = options.store || getDefaultStore();

  const visitorKeyResolver =
    options.visitorKeyResolver ||
    ((req: Request) =>
      req.visitorId || req.cookies?.visitorId || extractClientIp(req));

  const ipKeyResolver =
    options.ipKeyResolver || ((req: Request) => extractClientIp(req));

  return catchError(async (req: Request, res: Response, next: NextFunction) => {
    if (options.skip && (await options.skip(req))) {
      return next();
    }

    const resolvedVisitor = await visitorKeyResolver(req);
    const resolvedIp = await ipKeyResolver(req);

    const visitorKey = `${visitorPrefix}:${resolvedVisitor}`;
    const ipKey = `${ipPrefix}:${resolvedIp}`;

    const visitorLimit =
      typeof options.visitorLimit === "function"
        ? await options.visitorLimit(req)
        : options.visitorLimit;

    const ipLimit =
      typeof options.ipLimit === "function"
        ? await options.ipLimit(req)
        : options.ipLimit;

    const result = await store.incrementDual(
      visitorKey,
      ipKey,
      windowMs,
      visitorLimit,
      ipLimit,
    );

    // Header Semantics:
    // X-RateLimit-Limit: Primary browser allowance
    // X-RateLimit-Remaining: Remaining browser allowance
    // X-RateLimit-IP-Remaining: Aggregate IP pool visibility
    // X-RateLimit-Reset: Epoch seconds of window recovery
    res.setHeader(HTTP_HEADERS.RATELIMIT_LIMIT, visitorLimit);
    res.setHeader(HTTP_HEADERS.RATELIMIT_REMAINING, result.visitorRemaining);
    res.setHeader(HTTP_HEADERS.RATELIMIT_IP_REMAINING, result.ipRemaining);
    res.setHeader(
      HTTP_HEADERS.RATELIMIT_RESET,
      Math.ceil(result.resetTimeMs / 1000),
    );

    if (result.allowed) {
      return next();
    }

    // Dynamic derivation of Retry-After seconds
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetTimeMs - Date.now()) / 1000),
    );
    res.setHeader(HTTP_HEADERS.RETRY_AFTER, retryAfterSeconds);

    const errorMessage =
      result.rejectedReason === "ip"
        ? "High request volume from this network. Please slow down and try again shortly."
        : "Too many requests. Please try again shortly.";

    res.status(TOO_MANY_REQUESTS).json(fail(errorMessage, "TOO_MANY_REQUESTS"));
  });
}

/**
 * Creates a single-bucket rate limiter middleware.
 * Supports both standard sliding-window logs and atomic punitive lockouts.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const prefix = options.prefix || DEFAULT_KEY_PREFIX;
  const windowMs = options.windowMs;
  const blockDurationMs = options.blockDurationMs;
  const algorithm = options.algorithm || RateLimiterAlgorithm.SLIDING_WINDOW;
  const store = options.store || getDefaultStore();

  const keyResolver =
    options.keyResolver || ((req: Request) => extractClientIp(req));

  return catchError(async (req: Request, res: Response, next: NextFunction) => {
    if (options.skip && (await options.skip(req))) {
      return next();
    }

    const resolvedKey = await keyResolver(req);
    const fullKey = `${prefix}:${resolvedKey}`;

    const maxLimit =
      typeof options.max === "function" ? await options.max(req) : options.max;

    const isPunitive =
      typeof blockDurationMs === "number" && blockDurationMs > 0;

    const result = isPunitive
      ? await store.incrementPunitive(
          fullKey,
          `${fullKey}:blocked`,
          windowMs,
          maxLimit,
          blockDurationMs,
        )
      : await store.increment(fullKey, windowMs, maxLimit, algorithm);

    res.setHeader(HTTP_HEADERS.RATELIMIT_LIMIT, maxLimit);
    res.setHeader(HTTP_HEADERS.RATELIMIT_REMAINING, result.remaining);
    res.setHeader(
      HTTP_HEADERS.RATELIMIT_RESET,
      result.resetTimeMs > 0 ? Math.ceil(result.resetTimeMs / 1000) : 0,
    );

    if (result.allowed) {
      return next();
    }

    // Dynamic derivation of Retry-After seconds
    // (If resetTimeMs is 0 due to an indefinite lock, 3600 is used as a safe response fallback)
    const retryAfterSeconds =
      result.resetTimeMs > 0
        ? Math.max(1, Math.ceil((result.resetTimeMs - Date.now()) / 1000))
        : 3600;

    res.setHeader(HTTP_HEADERS.RETRY_AFTER, retryAfterSeconds);

    let errorMessage = "Too many requests. Please try again later.";
    if (result.isLocked) {
      const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      errorMessage = `Too many attempts. Please try again after ${mins} minutes.`;
    }

    res.status(TOO_MANY_REQUESTS).json(fail(errorMessage, "TOO_MANY_REQUESTS"));
  });
}
