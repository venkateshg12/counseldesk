import { expect, test } from "@playwright/test";

test("the Free consultation button opens the booking page", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Free consultation" })
    .click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(
    page.getByRole("heading", { name: "Book a free consultation" }),
  ).toBeVisible();
});

test("a visitor books a time, then cancels it from the manage link", async ({
  page,
}) => {
  await page.goto("/book");
  await page.getByRole("button", { name: "DUI" }).click();

  // The first open time of the first day.
  const firstDay = page.getByRole("region").filter({ hasText: /\d/ }).first();
  await expect(page.getByText("All times are Arizona time.")).toBeVisible();
  await firstDay.getByRole("button").first().click();

  await expect(page.getByRole("timer")).toContainText(
    "We're holding this time",
  );
  await page.getByLabel("Your name").fill("E2E Visitor");
  await page.getByLabel("Email").fill("visitor@e2e.test");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(
    page.getByRole("heading", { name: "You're booked" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reschedule or cancel" }).click();

  await expect(
    page.getByRole("heading", { name: "Your consultation" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Cancel consultation" }).click();
  await expect(
    page.getByText("Your consultation has been cancelled."),
  ).toBeVisible();

  // The link is dead after cancelling.
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("no longer valid");
});
