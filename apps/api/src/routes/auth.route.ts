import { Router } from "express";
import {
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  resetPasswordHandler,
} from "../controllers/auth.controller.js";
import authenticate from "../middleware/authenticate.js";
import {
  forgotAccountLimiter,
  forgotLimiter,
  forgotSourceLimiter,
  loginAccountLimiter,
  loginLimiter,
  loginSourceLimiter,
  refreshTokenLimiter,
  refreshTokenSourceLimiter,
  resetSourceLimiter,
} from "../config/rateLimiter.js";

export const authRoutes = Router();

authRoutes.post(
  "/login",
  loginSourceLimiter,
  loginAccountLimiter,
  loginLimiter,
  loginHandler,
);
// POST, not the port's GET: logging out changes state, and a GET can be triggered by an <img> tag.
authRoutes.post("/logout", logoutHandler);
// GET, matching the port and the cookie's Path. The refresh cookie is only sent to this exact path.
authRoutes.get(
  "/refresh",
  refreshTokenSourceLimiter,
  refreshTokenLimiter,
  refreshHandler,
);
authRoutes.get("/me", authenticate, meHandler);

// Both are POST with the secret in the body. The forgot limiters exist mostly to keep the endpoint
// from being used to flood one person's inbox.
authRoutes.post(
  "/password/forgot",
  forgotSourceLimiter,
  forgotAccountLimiter,
  forgotLimiter,
  forgotPasswordHandler,
);
authRoutes.post("/password/reset", resetSourceLimiter, resetPasswordHandler);
