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
