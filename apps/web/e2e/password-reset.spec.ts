import { expect, test } from "@playwright/test";

test("forgot password gives the same confirmation for any address", async ({
  page,
}) => {
  await page.goto("/staff/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/staff\/forgot-password/);

  // A fresh address each run, so the per-address rate limit never carries over between runs.
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@e2e.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByRole("status")).toContainText(
    "If an account exists for that email",
  );
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("a reset page without a link asks for a new one", async ({ page }) => {
  await page.goto("/staff/reset-password");
  await expect(page.locator('p[role="alert"]')).toContainText(
    "missing or incomplete",
  );
  await expect(
    page.getByRole("link", { name: "Request a new link" }),
  ).toBeVisible();
});

test("an invalid link is rejected, and the token is removed from the address bar", async ({
  page,
}) => {
  await page.goto("/staff/reset-password?token=not.a.real-link");
  await expect(page).toHaveURL(/\/staff\/reset-password$/);

  await page
    .getByLabel("New password", { exact: true })
    .fill("a long enough passphrase");
  await page
    .getByLabel("Confirm new password")
    .fill("a long enough passphrase");
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.locator('p[role="alert"]')).toContainText(
    "invalid or has expired",
  );
  await expect(
    page.getByRole("link", { name: "Request a new link" }),
  ).toBeVisible();
});

test("mismatched passwords are caught before any request", async ({ page }) => {
  await page.goto("/staff/reset-password?token=anything");
  await page
    .getByLabel("New password", { exact: true })
    .fill("a long enough passphrase");
  await page.getByLabel("Confirm new password").fill("something else entirely");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("do not match");
});
