import assert from "node:assert";
import { AppError } from "./appError.js";
import { HttpStatusCode } from "../../constants/http.js";
import { appErrorCode } from "../../constants/appErrorCode.js";

// Asserts a condition and throws an AppError if the condition is falsy.
type AppAssert = (
  condition: unknown,
  httpStatusCode: HttpStatusCode,
  message: string,
  appErrorCode?: appErrorCode,
) => asserts condition;

const appAssert: AppAssert = (
  condition: unknown,
  httpStatusCode,
  message,
  appErrorCode,
) => {
  assert(condition, new AppError(httpStatusCode, message, appErrorCode));
};

export default appAssert;
