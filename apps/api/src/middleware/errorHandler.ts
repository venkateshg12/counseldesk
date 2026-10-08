import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors/index.js";
import { fail } from "../utils/api/index.js";
import {
  BAD_REQUEST,
  INTERNAL_SERVER_ERROR,
  PAYLOAD_TOO_LARGE,
} from "../constants/http.js";
import { logger } from "../utils/logger.js";

import { clearAuthCookies, REFRESH_PATH } from "../utils/auth/index.js";

const handleZodError = (res: Response, error: ZodError) => {
  const errors = error.issues.map((issue) => ({
    message: issue.message,
    code: issue.path.join(".") || undefined,
  }));
  return res.status(BAD_REQUEST).json({ status: "error", data: null, errors });
};

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    return handleZodError(res, error);
  }

  if (req.path === REFRESH_PATH) {
    clearAuthCookies(res);
  }

  // express.json() errors carry a `type`. They're the client's fault, not a 500.
  const bodyError = error as { type?: string } | null;
  if (bodyError?.type === "entity.too.large") {
    return res
      .status(PAYLOAD_TOO_LARGE)
      .json(fail("Request body is too large.", "PAYLOAD_TOO_LARGE"));
  }
  if (bodyError?.type === "entity.parse.failed") {
    return res
      .status(BAD_REQUEST)
      .json(fail("Malformed JSON.", "INVALID_JSON"));
  }

  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json(fail(error.message, error.errorCode ?? "APP_ERROR"));
  }

  logger.error("unhandled error", {
    error,
    method: req.method,
    path: req.originalUrl.split("?")[0],
  });
  return res
    .status(INTERNAL_SERVER_ERROR)
    .json(fail("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}
