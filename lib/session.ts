// The only place pages and server actions learn who the user is. The role always comes
// from the database, never from the browser or the cookie.
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { connectDb } from "./db";
import { User } from "./models/user";
import type { Role } from "./schemas";

export type CurrentUser = { id: string; name: string; email: string; role: Role; mustChangePassword: boolean };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  await connectDb();
  const user = await User.findById(session.user.id).lean();
  if (!user || !user.active || user.tokenVersion !== session.tv) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  return user;
}

export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  return user;
}
