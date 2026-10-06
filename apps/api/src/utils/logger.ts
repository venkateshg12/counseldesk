import { LOG_LEVEL, NODE_ENV } from "../constants/env.js";
import { getRequestId } from "./requestContext.js";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const minLevel = LEVELS[LOG_LEVEL as Level] ?? LEVELS.info;

// Values under these keys never reach a log line, at any depth.
const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "apikey",
]);

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Error)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(inner),
      ]),
    );
  }
  return value;
};

// Errors don't serialise with JSON.stringify (their fields are non-enumerable).
const serialiseError = (error: Error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
});

const write = (level: Level, msg: string, fields: Fields = {}) => {
  if (LEVELS[level] < minLevel) return;

  const { error, ...rest } = fields;
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    requestId: getRequestId(),
    ...(redact(rest) as Fields),
    ...(error instanceof Error
      ? { error: serialiseError(error) }
      : error
        ? { error }
        : {}),
  };

  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (NODE_ENV === "development") {
    const { time, level: lvl, msg: message, ...details } = entry;
    const extra = Object.keys(details).length
      ? ` ${JSON.stringify(details)}`
      : "";
    stream.write(
      `${time.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${message}${extra}\n`,
    );
    return;
  }

  stream.write(`${JSON.stringify(entry)}\n`);
};

export const logger = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
