"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/models/audit-event";
import { User } from "@/lib/models/user";
import { hashPassword, tempPassword } from "@/lib/password";
import { createUserSchema, resetPasswordSchema, setActiveSchema } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

export async function createUser(input: unknown): Promise<Result<{ tempPassword: string }>> {
  const me = await requireOwner();
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };

  const password = tempPassword();
  try {
    const user = await User.create({ ...parsed.data, passwordHash: await hashPassword(password) });
    await audit({
      actorId: me.id,
      action: "user.create",
      entity: "users",
      entityId: user._id,
      after: { name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    if (isDuplicateKey(e)) return { ok: false, error: "A user with this email already exists." };
    throw e;
  }
  revalidatePath("/users");
  return { ok: true, tempPassword: password };
}

export async function setUserActive(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { userId, active } = parsed.data;
  if (userId === me.id) return { ok: false, error: "You can't deactivate your own account." };

  const user = await User.findByIdAndUpdate(userId, {
    active,
    ...(active ? {} : { $inc: { tokenVersion: 1 } }), // signs them out everywhere
  });
  if (!user) return { ok: false, error: "User not found." };
  await audit({
    actorId: me.id,
    action: active ? "user.activate" : "user.deactivate",
    entity: "users",
    entityId: user._id,
    before: { active: user.active },
    after: { active },
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function resetPassword(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  if (parsed.data.userId === me.id) return { ok: false, error: "Use “Change password” for your own account." };

  const user = await User.findByIdAndUpdate(parsed.data.userId, {
    passwordHash: await hashPassword(parsed.data.password),
    mustChangePassword: true, // they choose their own at next sign-in
    $inc: { tokenVersion: 1 }, // signs them out everywhere
  });
  if (!user) return { ok: false, error: "User not found." };
  await audit({ actorId: me.id, action: "user.reset_password", entity: "users", entityId: user._id });
  revalidatePath("/users");
  return { ok: true };
}
