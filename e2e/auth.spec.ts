import { expect, type Page, test } from "@playwright/test";

const SEED_PASSWORD = "fictional-dev-pw";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openNav(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click(); // phone: sidebar lives in a sheet
}

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/users");
  await expect(page).toHaveURL(/\/login$/);
  await expectNoHorizontalScroll(page);
});

test("a wrong password shows an error and keeps what was typed", async ({ page }) => {
  await signIn(page, "owner@example.test", "wrong-password");
  await expect(page.getByText("Wrong email or password")).toHaveAttribute("role", "alert");
  await expect(page.getByLabel("Email")).toHaveValue("owner@example.test");
});

test("owner adds a caller, who must set a password and can't reach owner pages", async ({ page, isMobile }, info) => {
  const email = `caller-${info.project.name}@example.test`;

  await signIn(page, "owner@example.test", SEED_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await openNav(page, isMobile);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("E2E Caller (FICTIONAL)");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Phone (optional)").fill("12345"); // invalid → inline error, input kept
  await dialog.getByRole("button", { name: "Create user" }).click();
  await expect(dialog.getByText("Enter a valid Sri Lankan phone number")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveValue("E2E Caller (FICTIONAL)");
  await dialog.getByLabel("Phone (optional)").fill("+94 77 000 0099");
  await dialog.getByRole("button", { name: "Create user" }).click();
  const tempPassword = (await dialog.locator("code").textContent())!;
  expect(tempPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText("Awaiting first sign-in");

  await page.context().clearCookies();
  await signIn(page, email, tempPassword);
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByLabel("Current password").fill(tempPassword);
  await page.getByLabel("New password", { exact: true }).fill("caller-own-pw-123");
  await page.getByLabel("Repeat new password").fill("caller-own-pw-123");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: /Hi, E2E Caller/ })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/users");
  await expect(page).toHaveURL(/\/today$/);
});

test("login works with the keyboard only", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow is a desktop concern");
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type("nimali@example.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type(SEED_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/today$/);
});

test("owner resets a password: generate, copy, confirm, and the user must change it", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const tag = `${info.project.name}-${Date.now()}-${info.repeatEachIndex}`;
  const email = `reset-${tag}@example.test`;
  const name = `Reset ${tag} (FICTIONAL)`;
  await signIn(page, "owner@example.test", SEED_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/users");
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name);
  await page.getByRole("dialog").getByLabel("Email").fill(email);
  await page.getByRole("dialog").getByRole("button", { name: "Create user" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: `Reset password for ${name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Reset password" })).toBeVisible();

  // Typed passwords must match.
  await dialog.getByLabel("New password").fill("first-password-1");
  await dialog.getByLabel("Confirm password").fill("second-password-2");
  await dialog.getByRole("button", { name: "Reset password" }).click();
  await expect(dialog.getByText("Passwords don't match")).toBeVisible();

  // Generate fills both fields, shows the password and copies it.
  await dialog.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Generated password copied to clipboard")).toBeVisible();
  const generated = await dialog.getByLabel("New password").inputValue();
  expect(generated).toMatch(/^\w{4}-\w{4}-\w{4}$/);
  await expect(dialog.getByLabel("Confirm password")).toHaveValue(generated);
  await expect(dialog.getByLabel("New password")).toHaveAttribute("type", "text");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
  await dialog.getByRole("button", { name: "Hide password" }).click();
  await expect(dialog.getByLabel("New password")).toHaveAttribute("type", "password");

  await dialog.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText(`Password reset. ${name} has been signed out everywhere.`)).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, email, generated);
  await expect(page).toHaveURL(/\/account\/password$/);
});
