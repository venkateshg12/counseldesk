import { Router } from "express";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
} from "../controllers/auth.controller.js";
import authenticate from "../middleware/authenticate.js";
import {
  loginAccountLimiter,
  loginLimiter,
  loginSourceLimiter,
  refreshTokenLimiter,
  refreshTokenSourceLimiter,
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
