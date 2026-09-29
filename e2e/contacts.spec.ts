import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fictional-dev-pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("owner creates a campaign, adds a contact and marks them enrolled", async ({ page }, info) => {
  const name = `E2E campaign ${info.project.name}`;
  await signIn(page, "owner@example.test");
  await page.goto("/campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("Class / intake").fill("2027 A/L Theory");
  await sheet.getByLabel("Nimali Test (FICTIONAL)", { exact: true }).check();
  await sheet.getByLabel("Daily target for Nimali Test (FICTIONAL)").fill("25");
  await sheet.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByText("Campaign created")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name }).click();
  await expect(page.getByText("No contacts yet")).toBeVisible();
  await page.getByRole("button", { name: "Add contact" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("Amaya Test (FICTIONAL)");
  await add.getByLabel("Phone", { exact: true }).fill("771234567"); // Excel-style, leading 0 lost
  await add.getByLabel("Assigned to").click();
  await page.getByRole("option", { name: "Nimali Test (FICTIONAL)" }).click();
  await add.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Contact added")).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "Amaya Test" });
  await expect(row).toContainText("0771234567");
  await row.getByRole("button", { name: /Amaya Test/ }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Stage").click();
  await page.getByRole("option", { name: "Enrolled" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, enrolled" }).click();
  await expect(page.getByText("Contact saved")).toBeVisible();
  await expect(row).toContainText("Enrolled");
});

test("owner filters, sorts, pages and bulk-tags contacts", async ({ page }) => {
  await signIn(page, "owner@example.test");
  await page.goto("/contacts");
  await expect(page.getByText("1–50 of 60").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("51–60 of 60").filter({ visible: true })).toBeVisible();

  await page.getByRole("button", { name: "Name" }).click(); // sort A→Z, back to page 1
  await expect(page.getByRole("row").nth(1)).toContainText("Test Student 01");

  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Caller").click();
  await page.getByRole("option", { name: "Unassigned" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/caller=none/);
  await expect(page.getByText("1–6 of 6").filter({ visible: true })).toBeVisible();

  await page.getByLabel("Search name, school or phone").filter({ visible: true }).fill("0710000009");
  await expect(page.getByText("1–1 of 1").filter({ visible: true })).toBeVisible();
  await page.getByLabel("Select all on this page").check();
  await page.getByLabel("Tag to add").fill("follow-up");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Updated 1 contact")).toBeVisible();
});

test("callers only see their own contacts", async ({ page }) => {
  await signIn(page, "nimali@example.test");
  await page.goto("/contacts");
  await expect(page.getByRole("heading", { name: "My contacts" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const search = page.getByLabel("Search name, school or phone").filter({ visible: true });
  await search.fill("Test Student 02");
  await expect(page.getByRole("row").filter({ hasText: "Test Student 02" })).toBeVisible();
  await search.fill("Test Student 01"); // assigned to Kasun
  await expect(page.getByText("No contacts match these filters.")).toBeVisible();

  await page.goto("/campaigns");
  await expect(page).toHaveURL(/\/today$/);
});
