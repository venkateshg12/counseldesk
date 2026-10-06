import { Router } from "express";
import {
  loginHandler,
  logoutHandler,
  refreshHandler,
} from "../controllers/auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/login", loginHandler);
// POST, not the port's GET: logging out changes state, and a GET can be triggered by an <img> tag.
authRoutes.post("/logout", logoutHandler);
// GET, matching the port and the cookie's Path. The refresh cookie is only sent to this exact path.
authRoutes.get("/refresh", refreshHandler);
