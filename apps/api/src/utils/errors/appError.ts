import { appErrorCode } from "../../constants/appErrorCode.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: appErrorCode;

  constructor(statusCode: number, message: string, errorCode?: appErrorCode) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;

    Error.captureStackTrace?.(this, this.constructor);
  }
}
