import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, users } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signedInAs } from "@/test/auth";
import { resetDb, testDb as db } from "@/test/db";
import { getUser, makeUser, type TestUser } from "@/test/fixtures";
import { createUser, resetPassword, setUserActive } from "./actions";

const newUser = { name: "Test Caller", email: "new@example.test", phone: "771234567", role: "caller" };
const countUsers = async () => (await db.select().from(users)).length;

let owner: TestUser;
let caller: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await makeUser("Owner", "owner");
  caller = await makeUser("Caller", "caller");
});

describe("authorization", () => {
  it("rejects signed-out requests", async () => {
    signedInAs(null);
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("rejects callers", async () => {
    signedInAs(caller);
    await expect(createUser(newUser)).rejects.toThrow(/^REDIRECT \/$/);
    await expect(resetPassword({ userId: owner.id, password: "x".repeat(10), confirm: "x".repeat(10) })).rejects.toThrow(/^REDIRECT \/$/);
    await expect(setUserActive({ userId: owner.id, active: false })).rejects.toThrow(/^REDIRECT \/$/);
    expect(await countUsers()).toBe(2);
  });

  it("rejects a session whose role changed or account was deactivated", async () => {
    signedInAs(owner);
    await db.update(users).set({ role: "caller" }).where(eq(users.id, owner.id));
    await expect(createUser(newUser)).rejects.toThrow(/^REDIRECT \/$/);
    await db.update(users).set({ role: "owner", active: false }).where(eq(users.id, owner.id));
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("rejects a session issued before a password reset", async () => {
    signedInAs(owner);
    await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, owner.id));
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("sends users with a temporary password to change it first", async () => {
    signedInAs(owner);
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, owner.id));
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /account/password");
  });

  it("treats a session id that isn't a UUID (e.g. from the MongoDB version) as signed out", async () => {
    signedInAs({ id: "6abb775522b1ba96fb2ff6ad", tokenVersion: 0 });
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });
});

describe("owner actions", () => {
  beforeEach(() => signedInAs(owner));

  it("creates a user with a working temporary password and an audit entry", async () => {
    const res = await createUser(newUser);
    expect(res.ok).toBe(true);
    const [created] = await db.select().from(users).where(eq(users.email, "new@example.test"));
    expect(created).toMatchObject({ phone: "0771234567", role: "caller", active: true, mustChangePassword: true });
    expect(await verifyPassword(res.ok ? res.tempPassword : "", created.passwordHash)).toBe(true);

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "user.create"));
    expect(event.actorId).toBe(owner.id);
    expect(JSON.stringify(event)).not.toMatch(/passwordHash|0771234567/);
  });

  it("rejects duplicate emails and unknown fields", async () => {
    expect(await createUser({ ...newUser, email: "CALLER@example.test" })).toMatchObject({ ok: false });
    expect(await createUser({ ...newUser, passwordHash: "injected" })).toMatchObject({ ok: false });
    expect(await createUser({ ...newUser, phone: "12345" })).toMatchObject({ ok: false });
    expect(await countUsers()).toBe(2);
  });

  it("deactivating signs the user out; owners can't deactivate themselves", async () => {
    expect(await setUserActive({ userId: caller.id, active: false })).toEqual({ ok: true });
    expect(await getUser(caller.id)).toMatchObject({ active: false, tokenVersion: 1 });
    expect(await setUserActive({ userId: owner.id, active: false })).toMatchObject({ ok: false });
  });

  it("resetting a password sets the owner's choice, forces a change and signs them out", async () => {
    const pw = "New-pass-2026";
    expect(await resetPassword({ userId: caller.id, password: pw, confirm: "different1" })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: caller.id, password: "short", confirm: "short" })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: owner.id, password: pw, confirm: pw })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: caller.id, password: pw, confirm: pw })).toEqual({ ok: true });
    const updated = await getUser(caller.id);
    expect(updated).toMatchObject({ mustChangePassword: true, tokenVersion: 1 });
    expect(await verifyPassword(pw, updated.passwordHash)).toBe(true);
    expect(JSON.stringify(await db.select().from(auditEvents))).not.toContain(pw);
  });
});
