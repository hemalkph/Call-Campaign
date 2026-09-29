import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fictional-dev-pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function check(page: Page, path: string | null) {
  if (path) await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400); // let open/close animations finish, or contrast is measured mid-fade
  path ??= page.url();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path}: ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
  expect(serious, serious.join("\n")).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
}

test("login page has no serious accessibility problems", async ({ page }) => {
  await check(page, "/login");
});

test("owner pages have no serious accessibility problems or sideways scrolling", async ({ page }) => {
  await signIn(page, "owner@example.test");
  for (const path of ["/dashboard", "/pipeline", "/campaigns", "/contacts", "/callbacks", "/templates", "/users", "/audit", "/account/password"])
    await check(page, path);
});

test("caller pages have no serious accessibility problems or sideways scrolling", async ({ page }) => {
  await signIn(page, "kasun@example.test");
  for (const path of ["/today", "/calling", "/whatsapp", "/callbacks", "/contacts"]) await check(page, path);
});

test("open dialogs and the callback picker have no serious accessibility problems", async ({ page }) => {
  await signIn(page, "owner@example.test");
  await page.goto("/contacts");
  await page.getByRole("button", { name: /Test Student 60/ }).click();
  await page.getByText("Calls (").waitFor();
  await check(page, null);

  await page.context().clearCookies();
  await signIn(page, "kasun@example.test");
  await page.goto("/calling");
  await page.getByRole("button", { name: /Callback requested/ }).click();
  await check(page, null);
  await page.getByRole("button", { name: "WhatsApp" }).click();
  await page.getByRole("dialog").waitFor();
  await check(page, null);
});
