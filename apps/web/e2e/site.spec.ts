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
