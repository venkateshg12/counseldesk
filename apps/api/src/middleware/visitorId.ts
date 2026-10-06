import type { RequestHandler } from "express";
import crypto from "crypto";
import { NODE_ENV } from "../constants/env.js";

/**
 * Lightweight middleware that provides an anonymous browser fairness identity.
 *
 * Flow:
 * 1. Checks if `req.cookies.visitorId` exists and is valid.
 * 2. If missing or malformed, generates an opaque UUID v4.
 * 3. Issues an HttpOnly cookie (SameSite=None; Secure in production, Lax locally), path "/", 1-year expiry.
 * 4. Attaches `req.visitorId` for consumption by subsequent rate limiters.
 *
 * Note: `visitorId` is a fairness identity for unauthenticated browser sessions,
 * NOT a security boundary. IP aggregate rate limiting runs alongside it to prevent
 * abuse via cookie deletion.
 */
export const visitorIdMiddleware: RequestHandler = (req, res, next) => {
  let visitorId = req.cookies?.visitorId as string | undefined;

  if (!visitorId || typeof visitorId !== "string" || visitorId.length > 100) {
    visitorId = crypto.randomUUID();
    res.cookie("visitorId", visitorId, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      // The storefront (Vercel) and API (Render) are different sites, so a Lax cookie is never
      // stored and every request looked like a new visitor. None requires Secure, hence the pairing.
      sameSite: NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }

  req.visitorId = visitorId;
  next();
};
