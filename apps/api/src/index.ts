import "dotenv/config";
import { PORT } from "./constants/env.js";
import { createApp } from "./app.js";

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const app = createApp();

  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server is listening on port ${PORT}`);
  });

  let shuttingDown = false;

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${reason} — closing`);

    // A client holding a keep-alive connection open shouldn't hold the deploy open with it.
    const forceExit = setTimeout(() => {
      console.error(
        "[shutdown] in-flight requests did not finish in time — exiting anyway",
      );
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      console.log("[shutdown] complete");
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] failed:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A rejection nobody handled would otherwise end the process with no context.
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled promise rejection:", reason);
    void shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    console.error("[fatal] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  console.error("[startup] failed:", error);
  process.exit(1);
});
