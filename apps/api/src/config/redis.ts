import type { RedisOptions } from "ioredis";
import {
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
  REDIS_USERNAME,
} from "../constants/env.js";

export const getRedisConfig = (): RedisOptions => ({
  host: REDIS_HOST,
  port: Number(REDIS_PORT),
  db: Number(REDIS_DB),
  username: REDIS_USERNAME || undefined,
  password: REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const getRateLimiterRedisConfig = (): RedisOptions => ({
  host: REDIS_HOST,
  port: Number(REDIS_PORT),
  db: Number(REDIS_DB),
  username: REDIS_USERNAME || undefined,
  password: REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 1, // Fail fast so circuit breaker trips to memory store
  connectTimeout: 2000, // max time to wait for a Redis connection
  commandTimeout: 1000, // max time to wait for a Redis command response (1 second)
  enableReadyCheck: false,
});

/*
"maxRetriesPerRequest tells ioredis how many times to retry an individual Redis command before giving up.
If it's set to 5, ioredis retries that command up to 5 times and then throws an error if Redis is still unavailable.
If it's set to null, ioredis doesn't give up after a fixed number of retries. It keeps the connection alive (reconnecting as needed),
which allows BullMQ's long-running workers to continue once Redis becomes available again."
 */

/*
"enableReadyCheck controls whether ioredis performs an additional readiness check after connecting to Redis.
When it's true, ioredis waits until Redis reports that it's fully ready before sending commands.
When it's false, it skips that extra check and starts using the connection immediately.
BullMQ commonly uses false because its long-running workers and reconnection logic don't require the extra readiness handshake."
 */
