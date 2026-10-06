import "dotenv/config";
import { PORT } from "./constants/env.js";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const app = createApp();

  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    logger.info("server listening", { port: Number(PORT) });
  });

  let shuttingDown = false;

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown started", { reason });

    // A client holding a keep-alive connection open shouldn't hold the deploy open with it.
    const forceExit = setTimeout(() => {
      logger.error("in-flight requests did not finish in time, exiting anyway");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.info("shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error("shutdown failed", { error });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A rejection nobody handled would otherwise end the process with no context.
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled promise rejection", { error: reason });
    void shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error });
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  logger.error("startup failed", { error });
  process.exit(1);
});
