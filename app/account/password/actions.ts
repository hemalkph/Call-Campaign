"use server";

import { signIn } from "@/auth";
import { eq, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db, users } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { newPasswordSchema } from "@/lib/schemas";
import { getCurrentUser } from "@/lib/session";

export async function changePassword(input: unknown): Promise<{ error: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "Your session has expired. Sign in again." };
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the highlighted fields." };

  const [user] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
  if (!user || !(await verifyPassword(parsed.data.current, user.passwordHash)))
    return { error: "Your current password is wrong." };

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: false,
      tokenVersion: sql`${users.tokenVersion} + 1`, // signs out other devices
    })
    .where(eq(users.id, user.id));
  await audit({ actorId: user.id, action: "user.change_password", entity: "users", entityId: user.id });

  // Re-issue this device's session with the new token version.
  await signIn("credentials", { email: user.email, password: parsed.data.password, redirectTo: "/" });
  return { error: "Password changed, but signing in again failed." };
}
