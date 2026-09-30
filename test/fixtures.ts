// Small builders for test data. Everything here is fictional.
import { eq } from "drizzle-orm";
import { campaignCallers, campaigns, contacts, users } from "@/lib/db";
import type { Role } from "@/lib/schemas";
import { testDb as db } from "./db";

export type TestUser = typeof users.$inferSelect;

export async function makeUser(name: string, role: Role, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase().replace(/\W/g, "")}@example.test`, passwordHash: "x", role, mustChangePassword: false, ...extra })
    .returning();
  return u;
}

export async function makeCampaign(
  callers: (TestUser | { user: TestUser; dailyCallTarget?: number })[] = [],
  extra: Partial<typeof campaigns.$inferInsert> = {},
) {
  const [c] = await db
    .insert(campaigns)
    .values({ name: "Oct", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-12-31", ...extra })
    .returning();
  if (callers.length)
    await db.insert(campaignCallers).values(
      callers.map((x, position) => ("user" in x ? { campaignId: c.id, userId: x.user.id, dailyCallTarget: x.dailyCallTarget, position } : { campaignId: c.id, userId: x.id, position })),
    );
  return c;
}

let phoneSeq = 0;
export async function makeContact(campaignId: string, name: string, extra: Partial<typeof contacts.$inferInsert> = {}) {
  const [c] = await db
    .insert(contacts)
    .values({ campaignId, name, phone: `07${String(10_000_000 + ++phoneSeq)}`, ...extra })
    .returning();
  return c;
}

export const getUser = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
export const getContact = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
