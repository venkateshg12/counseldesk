import { Router } from "express";
import { chatHandler } from "../controllers/chat.controller.js";
import { chatDailyLimiter, chatLimiter } from "../config/rateLimiter.js";

export const chatRoutes = Router();

// Daily cap first: it rejects the cheapest, most clearly abusive case before the short-window check.
chatRoutes.post("/", chatDailyLimiter, chatLimiter, chatHandler);
