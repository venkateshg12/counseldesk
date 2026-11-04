import { Router } from "express";
import {
  chatBookHandler,
  chatHandler,
} from "../controllers/chat.controller.js";
import {
  bookingWriteLimiter,
  chatDailyLimiter,
  chatLimiter,
} from "../config/rateLimiter.js";

export const chatRoutes = Router();

// Daily cap first: it rejects the cheapest, most clearly abusive case before the short-window check.
chatRoutes.post("/", chatDailyLimiter, chatLimiter, chatHandler);

// Books the slot a visitor tapped in the chat; the conversation must belong to their browser.
chatRoutes.post("/:conversationId/book", bookingWriteLimiter, chatBookHandler);
