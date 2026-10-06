import "dotenv/config";
import { pathToFileURL } from "node:url";
import { notifyWorker } from "./jobs/workers/notify.worker.js";
import { connectDB, closeDB } from "./config/db.js";
import { redisConnection } from "./jobs/redis/connection.js";
import { logger } from "./utils/logger.js";

/** Stops the workers taking new jobs and waits for the ones in flight. */
export const closeWorkers = async () => {
  await notifyWorker.close();
};

/*
  Imported by index.ts so one process serves requests and runs jobs; also runnable on its own
  (`pnpm --filter api worker`). Only the standalone process connects the database and owns the
  signal handlers — when imported, index.ts drives shutdown and calls closeWorkers().
 */
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  await connectDB();
  logger.info("worker process started");

  const shutdown = async (signal: string) => {
    logger.info("worker shutdown started", { signal });
    await closeWorkers();
    await closeDB();
    await redisConnection.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
