import {
  RateLimiterAlgorithm,
  type RateLimitResult,
  type DualRateLimitResult,
  type RateLimiterStore,
} from "../../types/rateLimiter.types.js";

export class MemoryRateLimiterStore implements RateLimiterStore {
  // Stores sliding window timestamps for each key
  private windows: Map<string, number[]> = new Map();
  // Stores active lockouts: lockKey -> expiresAt timestamp
  private locks: Map<string, number> = new Map();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 20000) {
    this.maxEntries = maxEntries;
    setInterval(() => this.cleanupExpired(), 60000).unref();
  }

  /**
   * Standard Non-Punitive Single-Bucket Sliding Window (Synchronous Atomic)
   */
  public incrementSync(
    key: string,
    windowMs: number,
    maxLimit: number,
    _requestId: string,
  ): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.windows.get(key) || [];
    // 1. Prune expired entries
    timestamps = timestamps.filter((t) => t > windowStart);

    const hits = timestamps.length;
    const oldest = timestamps.length > 0 ? timestamps[0]! : now;
    const resetTimeMs =
      timestamps.length > 0 ? oldest + windowMs : now + windowMs;

    // 2. Check threshold
    if (hits >= maxLimit) {
      this.windows.set(key, timestamps);
      return {
        allowed: false,
        totalHits: hits,
        limit: maxLimit,
        remaining: 0,
        resetTimeMs,
        isFallback: true,
      };
    }

    // 3. Commit
    this.ensureCapacity(this.windows);
    timestamps.push(now);
    this.windows.set(key, timestamps);

    const newHits = hits + 1;
    return {
      allowed: true,
      totalHits: newHits,
      limit: maxLimit,
      remaining: Math.max(0, maxLimit - newHits),
      resetTimeMs,
      isFallback: true,
    };
  }

  /**
   * Atomic Punitive Single-Bucket Sliding Window (Synchronous Atomic)
   */
  public incrementPunitiveSync(
    key: string,
    lockKey: string,
    windowMs: number,
    maxLimit: number,
    lockoutMs: number,
    _requestId: string,
  ): RateLimitResult {
    const now = Date.now();

    // 1. Check active lockout
    const lockExpiresAt = this.locks.get(lockKey);
    if (lockExpiresAt && now < lockExpiresAt) {
      return {
        allowed: false,
        totalHits: maxLimit,
        limit: maxLimit,
        remaining: 0,
        resetTimeMs: lockExpiresAt,
        isFallback: true,
        isLocked: true,
      };
    } else if (lockExpiresAt) {
      this.locks.delete(lockKey);
    }

    const windowStart = now - windowMs;
    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);

    const hits = timestamps.length;
    const oldest = timestamps.length > 0 ? timestamps[0]! : now;
    const resetTimeMs =
      timestamps.length > 0 ? oldest + windowMs : now + windowMs;

    // 2. Threshold exceeded: activate punitive lockout and clear window history
    if (hits >= maxLimit) {
      const lockoutUntil = now + lockoutMs;
      this.ensureCapacity(this.locks);
      this.locks.set(lockKey, lockoutUntil);
      this.windows.delete(key);

      return {
        allowed: false,
        totalHits: hits,
        limit: maxLimit,
        remaining: 0,
        resetTimeMs: lockoutUntil,
        isFallback: true,
        isLocked: true,
      };
    }

    // 3. Allowed: commit request
    this.ensureCapacity(this.windows);
    timestamps.push(now);
    this.windows.set(key, timestamps);

    const newHits = hits + 1;
    return {
      allowed: true,
      totalHits: newHits,
      limit: maxLimit,
      remaining: Math.max(0, maxLimit - newHits),
      resetTimeMs,
      isFallback: true,
      isLocked: false,
    };
  }

  /**
   * Atomic Dual-Bucket Sliding Window (Synchronous Atomic)
   * Either commits to both buckets or rejects without modifying either.
   */
  public incrementDualSync(
    visitorKey: string,
    ipKey: string,
    windowMs: number,
    visitorLimit: number,
    ipLimit: number,
    _requestId: string,
  ): DualRateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    // 1. Prune
    const visitorTimestamps = (this.windows.get(visitorKey) || []).filter(
      (t) => t > windowStart,
    );
    const ipTimestamps = (this.windows.get(ipKey) || []).filter(
      (t) => t > windowStart,
    );

    const visitorHits = visitorTimestamps.length;
    const ipHits = ipTimestamps.length;

    // 2. Compute oldest resets
    const visitorReset =
      visitorHits > 0 ? visitorTimestamps[0]! + windowMs : now + windowMs;
    const ipReset = ipHits > 0 ? ipTimestamps[0]! + windowMs : now + windowMs;

    // 3. Check visitor threshold
    if (visitorHits >= visitorLimit) {
      this.windows.set(visitorKey, visitorTimestamps);
      this.windows.set(ipKey, ipTimestamps);

      let resetTimeMs = visitorReset;
      if (ipHits >= ipLimit && ipReset > resetTimeMs) {
        resetTimeMs = ipReset;
      }

      return {
        allowed: false,
        visitorHits,
        visitorRemaining: 0,
        ipHits,
        ipRemaining: Math.max(0, ipLimit - ipHits),
        resetTimeMs,
        rejectedReason: "visitor",
        isFallback: true,
      };
    }

    // 4. Check IP threshold
    if (ipHits >= ipLimit) {
      this.windows.set(visitorKey, visitorTimestamps);
      this.windows.set(ipKey, ipTimestamps);

      let resetTimeMs = ipReset;
      if (visitorHits >= visitorLimit && visitorReset > resetTimeMs) {
        resetTimeMs = visitorReset;
      }

      return {
        allowed: false,
        visitorHits,
        visitorRemaining: Math.max(0, visitorLimit - visitorHits),
        ipHits,
        ipRemaining: 0,
        resetTimeMs,
        rejectedReason: "ip",
        isFallback: true,
      };
    }

    // 5. Both passed: Commit synchronously to both sets
    this.ensureCapacity(this.windows);
    visitorTimestamps.push(now);
    ipTimestamps.push(now);

    this.windows.set(visitorKey, visitorTimestamps);
    this.windows.set(ipKey, ipTimestamps);

    const newVisitorHits = visitorHits + 1;
    const newIpHits = ipHits + 1;

    return {
      allowed: true,
      visitorHits: newVisitorHits,
      visitorRemaining: Math.max(0, visitorLimit - newVisitorHits),
      ipHits: newIpHits,
      ipRemaining: Math.max(0, ipLimit - newIpHits),
      resetTimeMs: visitorReset,
      rejectedReason: "none",
      isFallback: true,
    };
  }

  // RateLimiterStore interface methods delegating to synchronous atomic methods
  public async increment(
    key: string,
    windowMs: number,
    maxLimit: number,
    _algorithm: RateLimiterAlgorithm = RateLimiterAlgorithm.SLIDING_WINDOW,
  ): Promise<RateLimitResult> {
    return this.incrementSync(key, windowMs, maxLimit, `${Date.now()}`);
  }

  public async incrementPunitive(
    key: string,
    lockKey: string,
    windowMs: number,
    maxLimit: number,
    lockoutMs: number,
  ): Promise<RateLimitResult> {
    return this.incrementPunitiveSync(
      key,
      lockKey,
      windowMs,
      maxLimit,
      lockoutMs,
      `${Date.now()}`,
    );
  }

  public async incrementDual(
    visitorKey: string,
    ipKey: string,
    windowMs: number,
    visitorLimit: number,
    ipLimit: number,
  ): Promise<DualRateLimitResult> {
    return this.incrementDualSync(
      visitorKey,
      ipKey,
      windowMs,
      visitorLimit,
      ipLimit,
      `${Date.now()}`,
    );
  }

  public async resetKey(key: string): Promise<void> {
    this.windows.delete(key);
    this.locks.delete(`${key}:blocked`);
    this.locks.delete(key);
  }

  private ensureCapacity(map: Map<string, unknown>): void {
    if (map.size >= this.maxEntries) {
      const firstKey = map.keys().next().value;
      if (firstKey) map.delete(firstKey);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    // Clean up expired locks
    for (const [key, expiresAt] of this.locks.entries()) {
      if (now >= expiresAt) {
        this.locks.delete(key);
      }
    }
    // Clean up empty or stale windows
    for (const [key, timestamps] of this.windows.entries()) {
      if (
        timestamps.length === 0 ||
        now - timestamps[timestamps.length - 1]! > 3600000
      ) {
        this.windows.delete(key);
      }
    }
  }
}
