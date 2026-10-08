import { MAX_BACKOFF_MS } from "../constants/llm.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// True for failures a second attempt might fix: timeouts, rate limits, server errors, network drops.
export const isRetryable = (error: unknown): boolean => {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
    return true;

  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return RETRYABLE_STATUS.has(status);

  // No HTTP status at all: the request never got a response (DNS, reset, refused).
  const code = (error as { code?: unknown } | null)?.code;
  return (
    error instanceof TypeError || code === "ECONNRESET" || code === "ETIMEDOUT"
  );
};

// Full jitter: a random wait between 0 and the exponential cap, so clients don't retry in lockstep.
const backoffMs = (attempt: number) =>
  Math.random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RetryOptions = {
  attempts: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

/*
  Runs fn up to `attempts` times. Each attempt gets its own timeout, combined with the caller's signal
  so a disconnected client cancels the attempt in flight. Stops immediately when the caller aborted
  or the error isn't worth retrying.
 */
export const withRetry = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { attempts, timeoutMs, signal }: RetryOptions,
) => {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fn(attemptSignal);
    } catch (error) {
      if (signal?.aborted || attempt >= attempts || !isRetryable(error))
        throw error;
      await sleep(backoffMs(attempt));
    }
  }
};
