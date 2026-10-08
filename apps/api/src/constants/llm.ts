// Per attempt, for JSON calls (routing, lead extraction).
export const JSON_TIMEOUT_MS = 15_000;
// Streams: the model must start within this, and finish within the overall limit.
export const FIRST_TOKEN_TIMEOUT_MS = 15_000;
export const STREAM_TIMEOUT_MS = 45_000;
// Attempts per provider for JSON calls, including the first.
export const JSON_ATTEMPTS = 2;
// Cap for one backoff wait.
export const MAX_BACKOFF_MS = 4_000;
