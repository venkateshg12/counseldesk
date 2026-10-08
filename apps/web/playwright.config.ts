import { defineConfig, devices } from "@playwright/test";

const API = "http://localhost:4100";
const SITE = "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false, // one shared database
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: SITE, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The API with the fake LLM against the test database, on its own port.
      command:
        "pnpm --filter api e2e:prepare && pnpm --filter api exec node --env-file=.env.test --import tsx src/index.ts",
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: "4100",
        CORS_ORIGIN: SITE,
        SITE_URL: SITE,
        STAFF_APP_URL: SITE,
        NODE_ENV: "development",
      },
    },
    {
      // The production build of the site (and the bundled widget), pointed at the E2E API.
      command:
        "pnpm --filter web build && pnpm --filter web exec next start --port 3100",
      url: SITE,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { NEXT_PUBLIC_API_URL: API },
    },
  ],
});
