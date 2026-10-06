import { Redis } from "ioredis";
import crypto from "crypto";
import { getRateLimiterRedisConfig } from "../../config/redis.js";
import {
  type RateLimitResult,
  type DualRateLimitResult,
  type RateLimiterStore,
  type RateLimiterAlgorithm,
  RateLimiterAlgorithm as Algorithms,
} from "../../types/rateLimiter.types.js";
import { RedisCircuitBreaker } from "./circuitBreaker.js";
import {
  DUAL_SLIDING_WINDOW_LUA,
  PUNITIVE_SLIDING_WINDOW_LUA,
  SLIDING_WINDOW_LUA,
} from "./luaScript.js";
import { MemoryRateLimiterStore } from "./memoryStore.js";

export class RedisRateLimiterStore implements RateLimiterStore {
  private redisClient: Redis;
  private circuitBreaker: RedisCircuitBreaker;
  private memoryFallback: MemoryRateLimiterStore;
  private isInternalClient: boolean = false;

  constructor(customClient?: Redis, circuitBreaker?: RedisCircuitBreaker) {
    if (customClient) {
      this.redisClient = customClient;
    } else {
      this.redisClient = new Redis(getRateLimiterRedisConfig());
      this.isInternalClient = true;
    }

    this.circuitBreaker = circuitBreaker || new RedisCircuitBreaker();
    this.memoryFallback = new MemoryRateLimiterStore();

    this.redisClient.on("error", () => {
      this.circuitBreaker.recordFailure();
    });

    this.redisClient.on("connect", () => {
      this.circuitBreaker.recordSuccess();
    });
  }

  /**
   * Standard Non-Punitive Single-Bucket Sliding Window
   */
  public async increment(
    key: string,
    windowMs: number,
    maxLimit: number,
    _algorithm: RateLimiterAlgorithm = Algorithms.SLIDING_WINDOW,
  ): Promise<RateLimitResult> {
    const requestId = crypto.randomUUID();

    return this.circuitBreaker.execute<RateLimitResult>(
      async () => {
        const now = Date.now();
        const res = (await this.redisClient.eval(
          SLIDING_WINDOW_LUA,
          1,
          key,
          now,
          windowMs,
          maxLimit,
          requestId,
        )) as [number, number, number, number];

        return {
          allowed: res[0] === 1,
          totalHits: res[1],
          limit: maxLimit,
          remaining: res[2],
          resetTimeMs: res[3],
          isFallback: false,
        };
      },
      async () => {
        return this.memoryFallback.incrementSync(
          key,
          windowMs,
          maxLimit,
          requestId,
        );
      },
    );
  }

  /**
   * Atomic Punitive Single-Bucket Sliding Window (Used for auth login/register/reset)
   */
  public async incrementPunitive(
    key: string,
    lockKey: string,
    windowMs: number,
    maxLimit: number,
    lockoutMs: number,
  ): Promise<RateLimitResult> {
    const requestId = crypto.randomUUID();

    return this.circuitBreaker.execute<RateLimitResult>(
      async () => {
        const now = Date.now();
        const res = (await this.redisClient.eval(
          PUNITIVE_SLIDING_WINDOW_LUA,
          2,
          key,
          lockKey,
          now,
          windowMs,
          maxLimit,
          lockoutMs,
          requestId,
        )) as [number, number, number, number, number];

        return {
          allowed: res[0] === 1,
          isLocked: res[1] === 1,
          totalHits: res[2],
          limit: maxLimit,
          remaining: res[3],
          resetTimeMs: res[4],
          isFallback: false,
        };
      },
      async () => {
        return this.memoryFallback.incrementPunitiveSync(
          key,
          lockKey,
          windowMs,
          maxLimit,
          lockoutMs,
          requestId,
        );
      },
    );
  }

  /**
   * Atomic Dual-Bucket Sliding Window (Used for global pre-auth limiter)
   */
  public async incrementDual(
    visitorKey: string,
    ipKey: string,
    windowMs: number,
    visitorLimit: number,
    ipLimit: number,
  ): Promise<DualRateLimitResult> {
    const requestId = crypto.randomUUID();

    return this.circuitBreaker.execute<DualRateLimitResult>(
      async () => {
        const now = Date.now();
        const res = (await this.redisClient.eval(
          DUAL_SLIDING_WINDOW_LUA,
          2,
          visitorKey,
          ipKey,
          now,
          windowMs,
          visitorLimit,
          ipLimit,
          requestId,
        )) as [number, number, number, number, number, number, number];

        const reasonCode = res[6];
        const rejectedReason: "none" | "visitor" | "ip" =
          reasonCode === 1 ? "visitor" : reasonCode === 2 ? "ip" : "none";

        return {
          allowed: res[0] === 1,
          visitorHits: res[1],
          visitorRemaining: res[2],
          ipHits: res[3],
          ipRemaining: res[4],
          resetTimeMs: res[5],
          rejectedReason,
          isFallback: false,
        };
      },
      async () => {
        return this.memoryFallback.incrementDualSync(
          visitorKey,
          ipKey,
          windowMs,
          visitorLimit,
          ipLimit,
          requestId,
        );
      },
    );
  }

  public async resetKey(key: string): Promise<void> {
    try {
      await this.redisClient.del(key, `${key}:blocked`);
      await this.memoryFallback.resetKey(key);
    } catch {
      this.circuitBreaker.recordFailure();
      await this.memoryFallback.resetKey(key);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isInternalClient) {
      await this.redisClient.quit();
    }
  }
}
