import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import { debugSearchHandler } from "../controllers/debug.controller.js";

export const debugRoutes = Router();

// Staff only: it spends embedding quota and reveals how retrieval works.
debugRoutes.get("/search", authenticate, debugSearchHandler);
