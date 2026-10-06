import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors/index.js";
import { fail } from "../utils/api/index.js";
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from "../constants/http.js";

const handleZodError = (res: Response, error: ZodError) => {
  const errors = error.issues.map((issue) => ({
    message: issue.message,
    code: issue.path.join(".") || undefined,
  }));
  return res.status(BAD_REQUEST).json({ status: "error", data: null, errors });
};

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    return handleZodError(res, error);
  }

  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json(fail(error.message, error.errorCode ?? "APP_ERROR"));
  }

  console.error("error", error);
  return res
    .status(INTERNAL_SERVER_ERROR)
    .json(fail("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}
