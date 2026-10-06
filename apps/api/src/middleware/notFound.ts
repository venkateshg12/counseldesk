import type { Request, Response } from "express";
import { NOT_FOUND } from "../constants/http.js";
import { fail } from "../utils/api/index.js";

export function notFound(req: Request, res: Response) {
  res
    .status(NOT_FOUND)
    .json(fail(`Route not Found: ${req.method} ${req.originalUrl}`));
}
