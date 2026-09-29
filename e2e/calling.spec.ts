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

// Each browser project uses a different fictional caller so the two runs don't touch the same contacts.
test("phone: caller works callbacks first, reschedules one and sends a WhatsApp message", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone flow");
  await page.context().route("https://wa.me/**", (r) => r.fulfill({ body: "WhatsApp (stubbed in tests)" }));
  await signIn(page, "nimali@example.test");

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("1 overdue")).toBeVisible();
  await expect(page.getByText("Test Student 02 (FICTIONAL)")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: "Start calling" }).click();
  await expect(page.getByRole("heading", { name: "Test Student 02 (FICTIONAL)" })).toBeVisible();
  await expect(page.getByText("Overdue callback")).toBeVisible();
  await expect(page.getByRole("link", { name: "Call", exact: true })).toHaveAttribute("href", "tel:0710000001");
  await expectNoHorizontalScroll(page);

  // WhatsApp: pick a template → wa.me opens with the filled text → confirm sent.
  await page.getByRole("button", { name: "WhatsApp" }).click();
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: /Class details/ }).click()]);
  const url = decodeURIComponent(popup.url());
  expect(url).toContain("https://wa.me/94710000001?text=");
  expect(url).toContain("Hi Test Student 02 (FICTIONAL), this is Nimali Test (FICTIONAL)");
  await popup.close();
  await page.getByRole("button", { name: "Yes, mark as sent" }).click();
  await expect(page.getByText("WhatsApp message logged")).toBeVisible();

  // Callback requested → tomorrow morning → save & next.
  await page.getByRole("button", { name: "Callback requested" }).click();
  await page.getByRole("button", { name: "Tomorrow morning" }).click();
  await expect(page.getByLabel("Date and time (Sri Lanka)")).toHaveValue(/T09:00$/);
  await page.getByRole("button", { name: /Save “Callback requested” & next/ }).click();
  await expect(page.getByRole("heading", { name: "Test Student 04 (FICTIONAL)" })).toBeVisible(); // today's callback is next
  await expect(page.getByText("Callback today")).toBeVisible();
  await expect(page.getByText("Test Student 02 (FICTIONAL): Callback requested")).toBeVisible();

  await page.goto("/callbacks?tab=upcoming");
  const item = page.getByRole("listitem").filter({ hasText: "Test Student 02" });
  await expect(item).toContainText("9:00 AM");
  await expectNoHorizontalScroll(page);

  await page.goto("/whatsapp");
  await expect(page.getByRole("listitem").filter({ hasText: "Test Student 02" })).toContainText("Messaged");
  await page.getByLabel("Not yet messaged").click(); // updates the URL; the list reloads
  await expect(page).toHaveURL(/notMessaged=yes/);
  await expect(page.getByRole("listitem").filter({ hasText: "Test Student 02" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("desktop: keyboard-only calling with undo, then the owner sees the history", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow");
  await signIn(page, "kasun@example.test");
  await page.goto("/calling");
  const first = (await page.getByRole("heading", { level: 2 }).first().textContent())!;
  await expect(page.getByText("Not called yet").first()).toBeVisible();

  // 5 = Interested, N = save & next
  await page.keyboard.press("5");
  await expect(page.getByRole("button", { name: /^Interested/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Notes (optional)").fill("Wants the Sunday batch");
  await page.getByLabel("Notes (optional)").blur();
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: first })).toHaveCount(0);

  // Undo brings the contact back with the outcome and note still filled in.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await expect(page.getByText("Call undone")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Interested/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("Wants the Sunday batch");

  // 6 = Callback requested
  await page.keyboard.press("6");
  await page.getByRole("button", { name: "In 2 hours" }).click();
  await page.getByRole("button", { name: /Save “Callback requested” & next/ }).click();
  await expect(page.getByRole("heading", { name: first })).toHaveCount(0);
  await expect(page.getByText("Calls today 1 / 30")).toBeVisible(); // Kasun's personal target

  // The owner sees the callback and the call history.
  await page.context().clearCookies();
  await signIn(page, "owner@example.test");
  await page.goto("/callbacks?tab=today");
  await expect(page.getByRole("listitem").filter({ hasText: first })).toContainText("Kasun Test (FICTIONAL)");
  await page.goto(`/contacts?q=${encodeURIComponent(first.replace(" (FICTIONAL)", ""))}`);
  await page.getByRole("button", { name: new RegExp(first.replace(/[()]/g, "\\$&")) }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Calls (1)")).toBeVisible();
  await expect(sheet.getByText("Callback requested").first()).toBeVisible();
  await expect(sheet.getByText("Pending")).toBeVisible();
});

test("owner manages templates with a live preview", async ({ page, isMobile }) => {
  test.skip(isMobile, "owner admin page");
  await signIn(page, "owner@example.test");
  await page.goto("/templates");
  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("E2E reminder (FICTIONAL)");
  await dialog.getByLabel("Message").fill("ආයුබෝවන් ");
  await dialog.getByRole("button", { name: "{name}" }).click();
  await expect(dialog.getByText("ආයුබෝවන් Kamal Perera")).toBeVisible();
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Template added")).toBeVisible();
  await expect(page.getByText("E2E reminder (FICTIONAL)")).toBeVisible();
});
