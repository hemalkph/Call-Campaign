"use server";

import { signIn } from "@/auth";
import { audit } from "@/lib/models/audit-event";
import { User } from "@/lib/models/user";
import { hashPassword, verifyPassword } from "@/lib/password";
import { newPasswordSchema } from "@/lib/schemas";
import { getCurrentUser } from "@/lib/session";

export async function changePassword(input: unknown): Promise<{ error: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "Your session has expired. Sign in again." };
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the highlighted fields." };

  const user = await User.findById(me.id);
  if (!user || !(await verifyPassword(parsed.data.current, user.passwordHash)))
    return { error: "Your current password is wrong." };

  user.passwordHash = await hashPassword(parsed.data.password);
  user.mustChangePassword = false;
  user.tokenVersion += 1; // signs out other devices
  await user.save();
  await audit({ actorId: user._id, action: "user.change_password", entity: "users", entityId: user._id });

  // Re-issue this device's session with the new token version.
  await signIn("credentials", { email: user.email, password: parsed.data.password, redirectTo: "/" });
  return { error: "Password changed, but signing in again failed." };
}
