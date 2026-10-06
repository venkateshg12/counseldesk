# Phase 38 — End-to-end tests

## 1. Goal

Playwright tests that drive real browsers through the whole product — site, widget, API, database,
staff screens — using the fake LLM (Phase 25), so they're deterministic, free and runnable in CI:

1. **Site:** pages render; a deep link `#anchor` lands on the heading; unknown pages 404.
2. **Widget:** open, ask, see the streamed answer with a citation link, follow it to the right heading.
3. **Refusal:** a legal-advice question gets the fixed refusal.
4. **Lead to staff:** give details in the widget → sign in as staff → the lead is listed → open the
   transcript → resolve the handoff.
5. **Accessibility:** zero axe violations on the home page with the widget open (optional add-on).

## 2. What I will understand after this phase

1. What end-to-end tests catch that integration tests can't (the browser, the build, CORS, cookies,
   Shadow DOM).
2. How Playwright starts several servers for a test run and waits for them.
3. How locators reach into an open Shadow DOM.
4. Why E2E tests are few and focused on journeys.

## 3. Prerequisites

- Phase 37 done.

## 4. Files

```
apps/web/
├── package.json                    (@playwright/test; e2e script)
├── playwright.config.ts            NEW
└── e2e/
    ├── site.spec.ts                NEW
    ├── widget.spec.ts              NEW
    └── lead-to-staff.spec.ts       NEW
apps/api/src/scripts/e2e-prepare.ts NEW  reset, ingest (fake embeddings), seed staff
.github/workflows/ci.yml            (e2e job)
```

## 5. Concepts

**What only E2E catches.** The production build of the site and the bundled widget; the browser's CORS
and cookie rules (credentialed requests, `SameSite`); Shadow DOM rendering; the citation link actually
opening the right heading; the staff gate redirecting. Integration tests call the API with `fetch` and
never see any of that.

**Few, journey-shaped tests.** E2E tests are slow and break for many reasons; a handful that each
follow a real user journey give most of the value. Logic edge cases stay in unit and integration tests.

**Playwright's `webServer`.** The config lists commands to start (the API with the fake LLM and the test
database, the built site), the URL to poll for readiness, and reuses already-running servers locally.

**Shadow DOM.** Playwright's CSS and text locators pierce **open** shadow roots by default, so
`page.getByRole("button", { name: "Open chat" })` finds the widget's launcher with no special syntax.
(That's one reason the widget uses `mode: "open"`.)

**Separate ports and data.** E2E runs the API on 4100 and the site on 3100 against the test database,
prepared from scratch by a script (reset → ingest with fake embeddings → seed a staff account). Your dev
servers on 4000/3000 and your dev data are untouched.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter web add -D @playwright/test@^1.63.0
pnpm --filter web exec playwright install chromium
```

### Step 2 — `apps/api/src/scripts/e2e-prepare.ts`

```ts
import "dotenv/config";
import { pool, orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { ingestPages } from "../services/ingest.service.js";
import { hashValue } from "../utils/auth/index.js";

// Fresh state for an E2E run: empty tables, the real pages with fake embeddings, one staff account.
const { rows } = await pool.query<{ tablename: string }>(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
);
await pool.query(
  `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`,
);
await ingestPages({ depth: 3 });
await orm.User.create({
  email: "staff@e2e.test",
  name: "E2E Staff",
  passwordHash: await hashValue("e2e-password-123"),
});
console.log("e2e database ready");
await closeDB();
```

`apps/api/package.json`:

```json
"e2e:prepare": "node --env-file=.env.test --import tsx src/scripts/e2e-prepare.ts"
```

Node 22 reads env files natively with `--env-file`, and `--import tsx` registers TypeScript support, so
no extra package is needed. The script's own `import "dotenv/config"` then loads `apps/api/.env` too,
but dotenv never overrides variables that are already set, so the test values win.

### Step 3 — `apps/web/playwright.config.ts`

```ts
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
```

- `NODE_ENV: "development"` for the API: plain-http cookies, as in Compose (Phase 27), and the fake LLM
  is refused in production anyway.
- Environment variables passed here override `.env.test` because `--env-file` doesn't overwrite values
  already in the environment.

`apps/web/package.json`: `"e2e": "playwright test"`. Add `apps/web/test-results/` and
`apps/web/playwright-report/` to `.gitignore`.

### Step 4 — `e2e/site.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test("content pages render and deep links land on the heading", async ({
  page,
}) => {
  await page.goto("/fees#dui-fees");
  const heading = page.locator("#dui-fees");
  await expect(heading).toHaveText("DUI fees");
  await expect(heading).toBeInViewport();
});

test("unknown pages are 404", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
});
```

### Step 5 — `e2e/widget.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test("asks a question, streams an answer, follows the citation", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("button", { name: "Do you handle DUI cases?" }).click();

  // The fake provider answers "Harbor & Vale Law can help with that [1]." and cites source 1.
  const citation = page.getByRole("link", { name: "[1]" }).first();
  await expect(citation).toBeVisible();
  await expect(
    page.getByText("General information only — not legal advice."),
  ).toBeVisible();

  const [cited] = await Promise.all([
    context.waitForEvent("page"),
    citation.click(),
  ]);
  await cited.waitForLoadState();
  const fragment = new URL(cited.url()).hash.slice(1);
  expect(fragment).not.toBe("");
  await expect(cited.locator(`[id="${fragment}"]`)).toBeVisible();
});

test("refuses legal advice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByLabel("Your message").fill("Will I go to jail for my DUI?");
  await page.getByLabel("Your message").press("Enter");
  await expect(page.getByText(/I can't give legal advice/)).toBeVisible();
});
```

The citation test proves the whole chain: retrieval found a real section, the API built its URL from
`SITE_URL`, the widget linked it, and the site has an element with that id.

### Step 6 — `e2e/lead-to-staff.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test("a lead from the widget appears for staff, who resolve the handoff", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  const input = page.getByLabel("Your message");
  await input.fill("Ana Diaz, 602-555-0100, it's about a DUI");
  await input.press("Enter");
  await expect(page.getByText(/Thank you, Ana Diaz/)).toBeVisible();

  await page.goto("/staff/leads");
  await expect(page).toHaveURL(/\/staff\/login/);
  await page.getByLabel("Email").fill("staff@e2e.test");
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("cell", { name: /Ana Diaz/ })).toBeVisible();
  await page.getByRole("link", { name: "Conversation" }).first().click();
  await expect(
    page.getByText("Ana Diaz, 602-555-0100, it's about a DUI"),
  ).toBeVisible();

  await page.goto("/staff/handoffs");
  await page.getByRole("button", { name: "Resolve" }).first().click();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
});
```

### Step 7 — Run in CI

Add a job to `.github/workflows/ci.yml` (same `services` block as the `ci` job):

```yaml
e2e:
  runs-on: ubuntu-latest
  timeout-minutes: 25
  needs: ci
  services:
    # …identical postgres and redis services as the ci job…
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm turbo run build --filter=api --filter=web --ui=stream
    - run: pnpm --filter api test:integration # migrates counseldesk_test as a side effect
    - run: pnpm --filter web exec playwright install --with-deps chromium
    - run: pnpm --filter web e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: apps/web/playwright-report/
```

The integration tests' global setup creates and migrates `counseldesk_test`, which E2E then reuses;
running them first saves a separate migration step and orders the cheap tests before the expensive
ones.

### Step 8 (optional) — Accessibility check with axe

```bash
pnpm --filter web add -D @axe-core/playwright
```

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page with the chat open has no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

(Flagged dependency; check its current version with `pnpm view @axe-core/playwright version` before
adding.)

## 7. Commit points

1. `test(e2e): add playwright setup with isolated api and site servers`
2. `test(e2e): cover site deep links, widget answers, citations and refusals`
3. `test(e2e): cover the lead-to-staff journey`
4. `ci: run e2e tests after the main ci job`

## 8. Verify

```bash
docker compose up -d --wait
pnpm --filter api test:integration      # creates/migrates counseldesk_test once
pnpm --filter web e2e
# 5 passed
pnpm --filter web exec playwright show-report    # traces of any failure
```

Break something visible on purpose — e.g. render headings without ids in `MarkdownPage` — and watch the
site and citation tests fail. Then restore it.

## 9. Common mistakes

- **Running E2E against dev servers and dev data.** Use the dedicated ports and the prepared test
  database.
- **Sleeping instead of waiting.** `await expect(locator).toBeVisible()` waits up to its timeout; fixed
  `waitForTimeout` calls make tests slow and flaky.
- **`mode: "closed"` shadow root.** Playwright (and assistive tech tooling) can't see inside it.
- **Real model calls in E2E.** Slow, costly and non-deterministic; that's the eval suite's job.
- **Asserting styles or pixel positions.** Assert roles, text and URLs.

## 10. Interview prep

**Q: What does your E2E suite cover?**
A: Three journeys in a real browser against the production build and a real database with a fake model:
content deep links, a widget question whose citation link opens the exact heading, and a lead created in
the widget being resolved by staff. Plus a legal-advice refusal and an axe accessibility check.

**Q: Why so few E2E tests?**
A: They're the slowest and most fragile layer; edge cases live in unit and integration tests. E2E proves
the pieces are wired together the way a user experiences them.

## 11. Resume-safe claim

"Added Playwright end-to-end tests covering the visitor-to-staff journey across the site, an embedded
Shadow-DOM widget, the API and the staff dashboard, running in CI with a deterministic fake LLM."

## 12. Definition of done

- [ ] `pnpm --filter web e2e` passes locally (5 tests, 6 with axe)
- [ ] A deliberately broken anchor makes the site and citation tests fail
- [ ] The e2e job runs green in CI
