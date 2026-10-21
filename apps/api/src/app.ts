import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import {
  CORS_ORIGIN,
  ENABLE_QUEUE_DASHBOARD,
  NODE_ENV,
  QUEUE_DASHBOARD_PASSWORD,
  QUEUE_DASHBOARD_USER,
} from "./constants/env.js";
import { ok } from "./utils/api/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { pool } from "./config/db.js";
import { SERVICE_UNAVAILABLE } from "./constants/http.js";

import { authRoutes } from "./routes/auth.route.js";
import { gmailRoutes } from "./routes/gmail.route.js";
import { debugRoutes } from "./routes/debug.route.js";
import { chatRoutes } from "./routes/chat.route.js";
import { staffRoutes } from "./routes/staff.route.js";
import { trustProxy } from "./utils/rateLimiter/index.js";
import { visitorIdMiddleware } from "./middleware/visitorId.js";
import { globalLimiter } from "./config/rateLimiter.js";

import { redisConnection } from "./jobs/redis/connection.js";
import { setupBullBoard } from "./jobs/dashboard/bull-board.js";

/**
 * Basic auth for the queue dashboard. Compared with a timing-safe digest comparison so the
 * credentials can't be recovered a character at a time.
 */
const queueDashboardAuth: express.RequestHandler = (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const [user, password] = Buffer.from(encoded, "base64")
      .toString()
      .split(":");
    if (
      matchesSecret(user, QUEUE_DASHBOARD_USER) &&
      matchesSecret(password, QUEUE_DASHBOARD_PASSWORD)
    ) {
      return next();
    }
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Queues"');
  res.status(401).send("Authentication required");
};

// Hashing first keeps the comparison length-independent, since timingSafeEqual throws on a
// length mismatch — which would itself leak the length.
const matchesSecret = (
  candidate: string | undefined,
  expected: string,
): boolean => {
  const a = crypto
    .createHash("sha256")
    .update(candidate ?? "")
    .digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};

export function createApp() {
  const app = express();

  const queueDashboardEnabled = ENABLE_QUEUE_DASHBOARD === "true";
  if (
    queueDashboardEnabled &&
    !(QUEUE_DASHBOARD_USER && QUEUE_DASHBOARD_PASSWORD)
  ) {
    throw new Error(
      "ENABLE_QUEUE_DASHBOARD is true but QUEUE_DASHBOARD_USER/QUEUE_DASHBOARD_PASSWORD are not set",
    );
  }
  if (queueDashboardEnabled) {
    app.use("/admin/queues", queueDashboardAuth, setupBullBoard());
  }

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
    const [postgresUp, redisUp] = await Promise.all([
      pool.query("SELECT 1").then(
        () => true,
        () => false,
      ),
      redisConnection.status === "ready"
        ? redisConnection.ping().then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    ]);

    res.status(postgresUp ? 200 : SERVICE_UNAVAILABLE).json(
      ok({
        status: postgresUp ? "ok" : "degraded",
        postgres: postgresUp ? "up" : "down",
        redis: redisUp ? "up" : "down",
      }),
    );
  });

  // Feature routers are mounted here, one phase at a time.
  // Before /auth: Google's redirect URI is /auth/gmail/callback.
  app.use("/auth/gmail", gmailRoutes);
  app.use("/auth", authRoutes);
  app.use("/debug", debugRoutes);
  app.use("/chat", chatRoutes);
  app.use("/staff", staffRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
