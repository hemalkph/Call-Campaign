import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import * as XLSX from "xlsx";

async function signInOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fictional-dev-pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard/);
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("dashboard shows per-caller progress and links to filtered lists", async ({ page }) => {
  await signInOwner(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "Nimali Test (FICTIONAL)" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Kasun Test (FICTIONAL)" })).toBeVisible();
  await expect(page.getByText("Calls per day")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: /Seminar/ }).click();
  await expect(page).toHaveURL(/source=Seminar/);
  await expect(page.getByText("1–30 of 30").filter({ visible: true })).toBeVisible(); // seed: every other contact came from a seminar
});

test("pipeline: move a card with the keyboard menu, confirm enrolment, see it in the audit log", async ({ page, isMobile }) => {
  test.skip(isMobile, "board management is a desktop task (drag works on phones too, but menus are what we test)");
  await signInOwner(page);
  await page.goto("/pipeline");
  const card = page.getByRole("listitem").filter({ hasText: "Test Student 11 (FICTIONAL)" }).last();
  await expect(page.getByRole("listitem", { name: /^Interested, \d+ contacts/ })).toContainText("Test Student 11");

  await card.getByRole("button", { name: "Move Test Student 11 (FICTIONAL)" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Payment details sent" }).click();
  await expect(page.getByRole("listitem", { name: /^Payment details sent/ })).toContainText("Test Student 11");

  await card.getByRole("button", { name: "Move Test Student 11 (FICTIONAL)" }).click();
  await page.getByRole("menuitem", { name: "Enrolled" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, enrolled" }).click();
  await expect(page.getByRole("listitem", { name: /^Enrolled/ })).toContainText("Test Student 11");

  await page.reload(); // saved on the server, not just on screen
  await expect(page.getByRole("listitem", { name: /^Enrolled/ })).toContainText("Test Student 11");

  await page.goto("/audit?action=contact.stage");
  const row = page.getByRole("row").filter({ hasText: "Test Student 11" }).first();
  await expect(row).toContainText("Stage changed");
  await expect(row).toContainText("Payment details sent → stage: Enrolled; via: pipeline");
});

test("owner exports the call log and per-caller performance as Excel", async ({ page, isMobile }) => {
  test.skip(isMobile, "exports are a desktop task");
  await signInOwner(page);
  await page.goto("/contacts");
  const download = async (label: string, item: string) => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: label }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: item }).click()]);
    return XLSX.read(readFileSync((await dl.path())!));
  };

  const calls = await download("Call log", "Call log as Excel");
  expect(XLSX.utils.sheet_to_json<string[]>(calls.Sheets.Calls, { header: 1 })[0]).toEqual([
    "Called at", "Contact", "Phone", "Caller", "Outcome", "Duration (sec)", "Notes",
  ]);

  const perf = await download("Per-caller performance (whole campaign)", "Per-caller performance as Excel");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(perf.Sheets.Performance);
  expect(rows.map((r) => r.Caller).sort()).toEqual(["Kasun Test (FICTIONAL)", "Nimali Test (FICTIONAL)"]);
  expect(rows.find((r) => r.Caller === "Kasun Test (FICTIONAL)")?.["Daily target"]).toBe(30);
});
