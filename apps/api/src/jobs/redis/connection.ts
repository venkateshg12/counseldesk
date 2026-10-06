import { Redis } from "ioredis";
import { getRedisConfig } from "../../config/redis.js";
import { logger } from "../../utils/logger.js";

export const redisConnection = new Redis(getRedisConfig());

redisConnection.on("connect", () => {
  logger.info("connected to redis", {});
});

redisConnection.on("error", (err) => {
  logger.error("redis connection error", { error: err });
});
