// The only place pages and server actions learn who the user is. The role always comes
// from the database, never from the browser or the cookie.
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db, users } from "./db";
import { recordId, type Role } from "./schemas";

export type CurrentUser = { id: string; name: string; email: string; role: Role; mustChangePassword: boolean };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = recordId.safeParse(session?.user?.id); // sessions from before the switch to Postgres carry old ids
  if (!session || !id.success) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id.data)).limit(1);
  if (!user || !user.active || user.tokenVersion !== session.tv) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
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
