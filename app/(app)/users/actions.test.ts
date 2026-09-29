import { beforeEach, describe, expect, it } from "vitest";
import "@/test/mongo";
import { signedInAs } from "@/test/auth";
import { AuditEvent } from "@/lib/models/audit-event";
import { User } from "@/lib/models/user";
import { verifyPassword } from "@/lib/password";
import { createUser, resetPassword, setUserActive } from "./actions";

const newUser = { name: "Test Caller", email: "new@example.test", phone: "771234567", role: "caller" };

let owner: InstanceType<typeof User>;
let caller: InstanceType<typeof User>;

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AuditEvent.deleteMany({})]);
  [owner, caller] = await User.create([
    { name: "Owner", email: "owner@example.test", passwordHash: "x", role: "owner", mustChangePassword: false },
    { name: "Caller", email: "caller@example.test", passwordHash: "x", role: "caller", mustChangePassword: false },
  ]);
});

describe("authorization", () => {
  it("rejects signed-out requests", async () => {
    signedInAs(null);
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("rejects callers", async () => {
    signedInAs(caller);
    await expect(createUser(newUser)).rejects.toThrow(/^REDIRECT \/$/);
    await expect(resetPassword({ userId: String(owner._id), password: "x".repeat(10), confirm: "x".repeat(10) })).rejects.toThrow(/^REDIRECT \/$/);
    await expect(setUserActive({ userId: String(owner._id), active: false })).rejects.toThrow(/^REDIRECT \/$/);
    expect(await User.countDocuments()).toBe(2);
  });

  it("rejects a session whose role changed or account was deactivated", async () => {
    signedInAs(owner);
    await User.updateOne({ _id: owner._id }, { role: "caller" });
    await expect(createUser(newUser)).rejects.toThrow(/^REDIRECT \/$/);
    await User.updateOne({ _id: owner._id }, { role: "owner", active: false });
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("rejects a session issued before a password reset", async () => {
    signedInAs(owner);
    await User.updateOne({ _id: owner._id }, { $inc: { tokenVersion: 1 } });
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /login");
  });

  it("sends users with a temporary password to change it first", async () => {
    signedInAs(owner);
    await User.updateOne({ _id: owner._id }, { mustChangePassword: true });
    await expect(createUser(newUser)).rejects.toThrow("REDIRECT /account/password");
  });
});

describe("owner actions", () => {
  beforeEach(() => signedInAs(owner));

  it("creates a user with a working temporary password and an audit entry", async () => {
    const res = await createUser(newUser);
    expect(res.ok).toBe(true);
    const created = await User.findOne({ email: "new@example.test" });
    expect(created).toMatchObject({ phone: "0771234567", role: "caller", active: true, mustChangePassword: true });
    expect(await verifyPassword(res.ok ? res.tempPassword : "", created!.passwordHash)).toBe(true);

    const event = await AuditEvent.findOne({ action: "user.create" }).lean();
    expect(String(event?.actorId)).toBe(String(owner._id));
    expect(JSON.stringify(event)).not.toMatch(/passwordHash|0771234567/);
  });

  it("rejects duplicate emails and unknown fields", async () => {
    expect(await createUser({ ...newUser, email: "CALLER@example.test" })).toMatchObject({ ok: false });
    expect(await createUser({ ...newUser, passwordHash: "injected" })).toMatchObject({ ok: false });
    expect(await createUser({ ...newUser, phone: "12345" })).toMatchObject({ ok: false });
    expect(await User.countDocuments()).toBe(2);
  });

  it("deactivating signs the user out; owners can't deactivate themselves", async () => {
    expect(await setUserActive({ userId: String(caller._id), active: false })).toEqual({ ok: true });
    expect(await User.findById(caller._id)).toMatchObject({ active: false, tokenVersion: 1 });
    expect(await setUserActive({ userId: String(owner._id), active: false })).toMatchObject({ ok: false });
  });

  it("resetting a password sets the owner's choice, forces a change and signs them out", async () => {
    const pw = "New-pass-2026";
    expect(await resetPassword({ userId: String(caller._id), password: pw, confirm: "different1" })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: String(caller._id), password: "short", confirm: "short" })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: String(owner._id), password: pw, confirm: pw })).toMatchObject({ ok: false });
    expect(await resetPassword({ userId: String(caller._id), password: pw, confirm: pw })).toEqual({ ok: true });
    const updated = await User.findById(caller._id);
    expect(updated).toMatchObject({ mustChangePassword: true, tokenVersion: 1 });
    expect(await verifyPassword(pw, updated!.passwordHash)).toBe(true);
    expect(JSON.stringify(await AuditEvent.find().lean())).not.toContain(pw);
  });
});
