"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db, users } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/tx";
import { hashPassword, tempPassword } from "@/lib/password";
import { createUserSchema, resetPasswordSchema, setActiveSchema } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function createUser(input: unknown): Promise<Result<{ tempPassword: string }>> {
  const me = await requireOwner();
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };

  const password = tempPassword();
  try {
    const [user] = await db
      .insert(users)
      .values({ ...parsed.data, passwordHash: await hashPassword(password) })
      .returning();
    await audit({
      actorId: me.id,
      action: "user.create",
      entity: "users",
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "A user with this email already exists." };
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

  const [before] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
  if (!before) return { ok: false, error: "User not found." };
  await db
    .update(users)
    .set({ active, ...(active ? {} : { tokenVersion: sql`${users.tokenVersion} + 1` }) }) // deactivating signs them out everywhere
    .where(eq(users.id, userId));
  await audit({
    actorId: me.id,
    action: active ? "user.activate" : "user.deactivate",
    entity: "users",
    entityId: userId,
    before: { active: before.active },
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

  const updated = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: true, // they choose their own at next sign-in
      tokenVersion: sql`${users.tokenVersion} + 1`, // signs them out everywhere
    })
    .where(eq(users.id, parsed.data.userId))
    .returning({ id: users.id });
  if (!updated.length) return { ok: false, error: "User not found." };
  await audit({ actorId: me.id, action: "user.reset_password", entity: "users", entityId: parsed.data.userId });
  revalidatePath("/users");
  return { ok: true };
}
