import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import { isBadModelOutput, isRetryable, withRetry } from "./reliability.js";

const httpError = (status: number) => Object.assign(new Error("x"), { status });

describe("isRetryable", () => {
  it("retries rate limits and server errors", () => {
    for (const status of [408, 429, 500, 502, 503, 504])
      expect(isRetryable(httpError(status))).toBe(true);
  });

  it("does not retry client errors that would fail identically", () => {
    for (const status of [400, 401, 403, 404])
      expect(isRetryable(httpError(status))).toBe(false);
  });

  it("retries timeouts and network failures", () => {
    expect(isRetryable(new DOMException("slow", "TimeoutError"))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  it("does not retry validation failures", () => {
    expect(isRetryable(new SyntaxError("bad json"))).toBe(false);
  });
});

describe("isBadModelOutput", () => {
  it("recognises malformed JSON and off-schema output, and nothing else", () => {
    expect(isBadModelOutput(new SyntaxError("bad json"))).toBe(true);
    expect(isBadModelOutput(new ZodError([]))).toBe(true);
    expect(isBadModelOutput(httpError(503))).toBe(false);
    expect(isBadModelOutput(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  const options = { attempts: 3, timeoutMs: 1_000 };

  it("retries bad model output only when asked to", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const flaky = () =>
      vi
        .fn()
        .mockRejectedValueOnce(new SyntaxError("bad json"))
        .mockResolvedValue("ok");

    const without = flaky();
    await expect(withRetry(without, options)).rejects.toThrow("bad json");
    expect(without).toHaveBeenCalledTimes(1);

    const withRule = flaky();
    await expect(
      withRetry(withRule, { ...options, retryIf: isBadModelOutput }),
    ).resolves.toBe("ok");
    expect(withRule).toHaveBeenCalledTimes(2);
  });

  it("returns the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, options)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // zero backoff
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, options)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("stops at once on a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(401));
    await expect(withRetry(fn, options)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fn = vi.fn().mockRejectedValue(httpError(503));
    await expect(withRetry(fn, options)).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("does not retry once the caller has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockRejectedValue(httpError(503));
    await expect(
      withRetry(fn, { ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
