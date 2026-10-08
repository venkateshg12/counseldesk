import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    // One database: test files run one after another, so truncation in one can't break another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
