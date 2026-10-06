import { Router } from "express";
import { loginHandler, logoutHandler } from "../controllers/auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/login", loginHandler);
// POST, not the port's GET: logging out changes state, and a GET can be triggered by an <img> tag.
authRoutes.post("/logout", logoutHandler);
