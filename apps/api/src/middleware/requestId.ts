import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { runWithRequestContext } from "../utils/requestContext.js";
import { logger } from "../utils/logger.js";

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  const startedAt = process.hrtime.bigint();

  res.setHeader("X-Request-Id", id);

  // One access-log line per request, written when the response has been sent.
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    runWithRequestContext({ requestId: id }, () =>
      logger.info("request completed", {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      }),
    );
  });

  runWithRequestContext({ requestId: id }, next);
};
