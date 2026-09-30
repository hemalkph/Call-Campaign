import { beforeEach, expect, it } from "vitest";
import { resetDb, testDb as db } from "@/test/db";
import { callbacks, calls, campaignCallers, campaigns, contacts, users, whatsappLogs } from "./db";
import { callerPerformance, dailyCalls, stageCounts, topSources } from "./reports";
import type { Outcome } from "./vocab";

// 2 Oct 2026, 10:00 in Colombo
const now = new Date("2026-10-02T04:30:00Z");
let campaignId: string;
let nimali: string, kasun: string;

beforeEach(async () => {
  await resetDb();
  [{ id: nimali }, { id: kasun }] = await db
    .insert(users)
    .values([
      { name: "Nimali", email: "n@example.test", passwordHash: "x", role: "caller" },
      { name: "Kasun", email: "k@example.test", passwordHash: "x", role: "caller" },
    ])
    .returning({ id: users.id });
  [{ id: campaignId }] = await db
    .insert(campaigns)
    .values({ name: "Oct", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-12-31", dailyCallTarget: 40 })
    .returning({ id: campaigns.id });
  await db.insert(campaignCallers).values([
    { campaignId, userId: nimali, dailyCallTarget: 25, position: 0 },
    { campaignId, userId: kasun, position: 1 },
  ]);
  const [a, b] = await db
    .insert(contacts)
    .values([
      { campaignId, name: "A", phone: "0711111111", assignedTo: nimali, stage: "enrolled", source: "Seminar" },
      { campaignId, name: "B", phone: "0712222222", assignedTo: nimali, stage: "interested", source: "Seminar" },
      { campaignId, name: "C", phone: "0713333333", assignedTo: kasun, source: "Facebook ad" },
      { campaignId, name: "D", phone: "0714444444", assignedTo: null },
    ])
    .returning();
  const call = (callerId: string, outcome: Outcome, calledAt: string) => ({ campaignId, contactId: a.id, callerId, outcome, calledAt: new Date(calledAt) });
  await db.insert(calls).values([
    call(nimali, "answered", "2026-10-01T18:30:00Z"), // 00:00 on 2 Oct → today
    call(nimali, "no_answer", "2026-10-02T04:00:00Z"), // today
    call(nimali, "interested", "2026-10-01T18:29:00Z"), // 23:59 on 1 Oct → yesterday
    call(kasun, "busy", "2026-09-10T05:00:00Z"), // before the 14-day window (19 Sep – 2 Oct)
  ]);
  await db.insert(callbacks).values([
    { campaignId, contactId: b.id, callerId: nimali, dueAt: new Date("2026-10-02T03:00:00Z") }, // overdue
    { campaignId, contactId: a.id, callerId: nimali, dueAt: new Date("2026-10-03T03:00:00Z"), status: "done" },
  ]);
  await db.insert(whatsappLogs).values({ campaignId, contactId: a.id, callerId: kasun });
});

it("summarises each caller, with today in Sri Lanka time", async () => {
  const rows = await callerPerformance(campaignId, now);
  expect(rows.map((r) => r.name)).toEqual(["Nimali", "Kasun"]);
  expect(rows[0]).toMatchObject({
    target: 25, callsToday: 2, reachedToday: 1, calls: 3, reached: 2,
    contacts: 2, open: 1, interested: 1, enrolled: 1, pendingCallbacks: 1, overdueCallbacks: 1, whatsapp: 0,
  });
  expect(rows[1]).toMatchObject({ target: 40, callsToday: 0, calls: 1, reached: 0, contacts: 1, whatsapp: 1 });
});

it("buckets calls per Sri Lankan day", async () => {
  const days = await dailyCalls(campaignId, 14, now);
  expect(days).toHaveLength(14);
  expect(days.at(-1)).toEqual({ day: "2026-10-02", reached: 1, notReached: 1 });
  expect(days.at(-2)).toEqual({ day: "2026-10-01", reached: 1, notReached: 0 });
  expect(days[0].day).toBe("2026-09-19");
  expect(days.reduce((n, d) => n + d.reached + d.notReached, 0)).toBe(3); // the 10 Sep call is left out
});

it("counts stages and sources", async () => {
  expect(await stageCounts(campaignId)).toMatchObject({ new: 2, interested: 1, enrolled: 1, contacted: 0 });
  expect(await topSources(campaignId)).toEqual([
    { source: "Seminar", total: 2, enrolled: 1 },
    { source: "", total: 1, enrolled: 0 },
    { source: "Facebook ad", total: 1, enrolled: 0 },
  ]);
});
