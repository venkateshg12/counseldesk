import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import { staffApiLimiter } from "../config/rateLimiter.js";
import {
  listHandoffsHandler,
  listLeadsHandler,
  resolveHandoffHandler,
  statsHandler,
  traceHandler,
  transcriptHandler,
} from "../controllers/staff.controller.js";

export const staffRoutes = Router();

// Every staff route needs a live session; the limiter is keyed by the staff user, so it comes after.
staffRoutes.use(authenticate, staffApiLimiter);

staffRoutes.get("/leads", listLeadsHandler);
staffRoutes.get("/handoffs", listHandoffsHandler);
staffRoutes.get("/conversations/:id", transcriptHandler);
staffRoutes.post("/handoffs/:id/resolve", resolveHandoffHandler);
staffRoutes.get("/stats", statsHandler);
staffRoutes.get("/traces/:id", traceHandler);
