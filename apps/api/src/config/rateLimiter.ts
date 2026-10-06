import type { Request } from "express";
import { createDualRateLimiter } from "../middleware/rateLimiter.js";
import { extractClientIp } from "../utils/rateLimiter/ipExtractor.js";
import {
  FIVE_MINUTES_MS,
  GLOBAL_IP_PREFIX,
  GLOBAL_VISITOR_PREFIX,
} from "../constants/rateLimiter.constant.js";

/*
  Key Resolvers
 */
export const visitorKeyResolver = (req: Request): string => {
  return (
    req.visitorId || (req.cookies?.visitorId as string) || extractClientIp(req)
  );
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
