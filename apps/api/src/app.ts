import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, NODE_ENV } from "./constants/env.js";
import { ok } from "./utils/api/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { pool } from "./config/db.js";
import { SERVICE_UNAVAILABLE } from "./constants/http.js";

import { authRoutes } from "./routes/auth.route.js";
import { trustProxy } from "./utils/rateLimiter/index.js";
import { visitorIdMiddleware } from "./middleware/visitorId.js";
import { globalLimiter } from "./config/rateLimiter.js";

export function createApp() {
  const app = express();

  // Trust exactly the proxies the rate limiter trusts, so req.ip and the limiter agree.
  app.set("trust proxy", trustProxy);

  app.use(requestId);

  // Baseline response headers. HSTS only in production, where the API is served over HTTPS.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: NODE_ENV === "production" ? undefined : false,
    }),
  );

  const corsOrigin = CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: corsOrigin, credentials: true }));

  // Chat messages are short; a small body limit stops someone posting megabytes into the LLM path.
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use(visitorIdMiddleware);
  app.use(globalLimiter);

  // Declared before the feature routers, so a router that applies auth to everything it sees can
  // never put /health behind a login (that bug happened in e-commerce).
  app.get("/health", async (_req, res) => {
    const postgresUp = await pool.query("SELECT 1").then(
      () => true,
      () => false,
    );

    res.status(postgresUp ? 200 : SERVICE_UNAVAILABLE).json(
      ok({
        status: postgresUp ? "ok" : "degraded",
        postgres: postgresUp ? "up" : "down",
      }),
    );
  });

  // Feature routers are mounted here, one phase at a time.
  app.use("/auth", authRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
