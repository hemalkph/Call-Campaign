import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { testDb as db } from "@/test/db";
import { callbacks, campaigns, contacts, uuidv7 } from "./schema";

it("uuidv7 ids are valid UUIDs that sort by creation time", async () => {
  const a = uuidv7();
  await new Promise((r) => setTimeout(r, 2));
  const b = uuidv7();
  expect(z.uuid().safeParse(a).success).toBe(true);
  expect(a[14]).toBe("7");
  expect(a < b).toBe(true);
});

it("the database enforces the key rules", async () => {
  const [c] = await db.insert(campaigns).values({ name: "C", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-12-31" }).returning();
  const [x] = await db.insert(contacts).values({ campaignId: c.id, name: "X", phone: "0711111111" }).returning();

  // One phone per campaign.
  await expect(db.insert(contacts).values({ campaignId: c.id, name: "Y", phone: "0711111111" })).rejects.toThrow();
  // One pending callback per contact (done ones don't count).
  const due = new Date();
  await db.insert(callbacks).values({ campaignId: c.id, contactId: x.id, dueAt: due });
  await expect(db.insert(callbacks).values({ campaignId: c.id, contactId: x.id, dueAt: due })).rejects.toThrow();
  await db.insert(callbacks).values({ campaignId: c.id, contactId: x.id, dueAt: due, status: "done" });
  // Stage values and campaign dates are checked.
  await expect(db.update(contacts).set({ stage: "maybe" as never }).where(eq(contacts.id, x.id))).rejects.toThrow();
  await expect(db.insert(campaigns).values({ name: "Bad", classLabel: "A/L", startDate: "2026-10-02", endDate: "2026-10-01" })).rejects.toThrow();
});

it("every table has row-level security enabled", async () => {
  const res = await db.execute(sql`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity and relname not like '__drizzle%'`);
  expect(res.rows).toEqual([]);
});
