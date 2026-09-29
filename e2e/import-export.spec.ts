import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import * as XLSX from "xlsx";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fictional-dev-pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard/);
}

async function downloadText(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), buffer: readFileSync((await dl.path())!) };
}

test("owner imports the sample CSV, then exports contacts as CSV and Excel", async ({ page }, info) => {
  // The docs sample, with phone numbers unique to this browser project so parallel runs don't collide.
  const prefix = info.project.name === "desktop" ? "713" : "714";
  const csv = readFileSync("docs/sample-contacts.csv", "utf8").replaceAll("712000", `${prefix}000`).replaceAll("71 200", `${prefix.slice(0, 2)} ${prefix[2]}00`);

  await signIn(page);
  // Its own campaign, so other tests' counts on the seeded campaign aren't affected.
  const campaign = `Import test ${info.project.name} ${Date.now()}`;
  await page.goto("/campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(campaign);
  await page.getByRole("dialog").getByLabel("Class / intake").fill("2027 A/L");
  await page.getByRole("dialog").getByLabel("Nimali Test (FICTIONAL)", { exact: true }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Create campaign" }).click();
  await page.getByRole("link", { name: campaign }).click();
  await expect(page).toHaveURL(/campaign=/);
  const campaignUrl = page.url();
  await page.getByRole("button", { name: "Import CSV" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

  await expect(sheet.getByLabel("Name *")).toContainText("Name"); // guessed mapping
  await expect(sheet.getByLabel("Phone *")).toContainText("Phone");
  await expect(sheet.getByLabel("Parent's phone")).toContainText("Parent Phone");
  await sheet.getByRole("button", { name: "Continue" }).click();

  await expect(sheet.getByText("4 new")).toBeVisible();
  await expect(sheet.getByText("1 duplicate in file")).toBeVisible();
  await expect(sheet.getByText("1 missing name")).toBeVisible();
  await expect(sheet.getByText("1 invalid phone")).toBeVisible();
  await sheet.getByLabel("Add tags to every contact").fill("e2e-import");
  await sheet.getByRole("button", { name: "Import 4 contacts" }).click();

  await expect(sheet.getByText("Import finished")).toBeVisible();
  const rejected = await downloadText(page, () => sheet.getByRole("button", { name: "Download rejected rows" }).click());
  const text = rejected.buffer.toString("utf8");
  expect(text.startsWith("﻿Row,Reason,Name,Phone")).toBe(true);
  expect(text).toContain("Duplicate in file");
  expect(text).toContain("Invalid phone");
  await sheet.getByRole("button", { name: "Done" }).click();

  await page.getByLabel("Search name, school or phone").filter({ visible: true }).fill("චමරි");
  const row = page.getByRole("row").filter({ hasText: "චමරි" });
  await expect(row).toContainText(`0${prefix}000003`); // "+94 71 300 0003" normalized

  // Running the same file again imports nothing new.
  await page.getByRole("button", { name: "Import CSV" }).click();
  await sheet.locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await sheet.getByRole("button", { name: "Continue" }).click();
  await expect(sheet.getByText("0 new")).toBeVisible();
  await expect(sheet.getByText("5 already in campaign")).toBeVisible(); // incl. the in-file duplicate
  await expect(sheet.getByRole("button", { name: "Import 0 contacts" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Export what the filter shows: the imported rows tagged e2e-import.
  await page.goto(`${campaignUrl}&tag=e2e-import`);
  await expect(page.getByText("1–4 of 4").filter({ visible: true })).toBeVisible();
  const xlsx = await downloadText(page, async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Contacts" }).click();
    await page.getByRole("menuitem", { name: "Contacts as Excel" }).click();
  });
  expect(xlsx.name).toMatch(/contacts-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const ws = XLSX.read(xlsx.buffer).Sheets.Contacts;
  const sheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
  expect(sheetRows).toHaveLength(4);
  expect(sheetRows.every((r) => r.Tags.includes("e2e-import"))).toBe(true);
  expect(ws.B2.t).toBe("s");
  expect(String(ws.B2.v)).toMatch(/^07\d{8}$/);

  const csvOut = await downloadText(page, async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Contacts" }).click();
    await page.getByRole("menuitem", { name: "Contacts as CSV" }).click();
  });
  expect(csvOut.buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(csvOut.buffer.toString("utf8")).toContain("චමරි");
});
