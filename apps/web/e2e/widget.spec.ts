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
