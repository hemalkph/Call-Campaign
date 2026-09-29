import { beforeEach, expect, it } from "vitest";
import "@/test/mongo";
import { Call } from "./models/call";
import { Callback } from "./models/callback";
import { Campaign } from "./models/campaign";
import { Contact } from "./models/contact";
import { User } from "./models/user";
import { WhatsappLog } from "./models/whatsapp-log";
import { callerPerformance, dailyCalls, stageCounts, topSources } from "./reports";
import type { Outcome } from "./vocab";

// 2 Oct 2026, 10:00 in Colombo
const now = new Date("2026-10-02T04:30:00Z");
let campaignId: string;
let nimali: InstanceType<typeof User>, kasun: InstanceType<typeof User>;

beforeEach(async () => {
  await Promise.all([User, Campaign, Contact, Call, Callback, WhatsappLog].map((m) => (m as typeof User).deleteMany({})));
  [nimali, kasun] = await User.create([
    { name: "Nimali", email: "n@example.test", passwordHash: "x", role: "caller" },
    { name: "Kasun", email: "k@example.test", passwordHash: "x", role: "caller" },
  ]);
  const c = await Campaign.create({
    name: "Oct", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-12-31", dailyCallTarget: 40,
    callers: [{ userId: nimali._id, dailyCallTarget: 25 }, { userId: kasun._id }],
  });
  campaignId = String(c._id);
  const [a, b] = await Contact.create([
    { campaignId, name: "A", phone: "0711111111", assignedTo: nimali._id, stage: "enrolled", source: "Seminar" },
    { campaignId, name: "B", phone: "0712222222", assignedTo: nimali._id, stage: "interested", source: "Seminar" },
    { campaignId, name: "C", phone: "0713333333", assignedTo: kasun._id, source: "Facebook ad" },
    { campaignId, name: "D", phone: "0714444444", assignedTo: null },
  ]);
  const call = (callerId: typeof nimali._id, outcome: Outcome, calledAt: string) => ({ campaignId, contactId: a._id, callerId, outcome, calledAt: new Date(calledAt) });
  await Call.create([
    call(nimali._id, "answered", "2026-10-01T18:30:00Z"), // 00:00 on 2 Oct → today
    call(nimali._id, "no_answer", "2026-10-02T04:00:00Z"), // today
    call(nimali._id, "interested", "2026-10-01T18:29:00Z"), // 23:59 on 1 Oct → yesterday
    call(kasun._id, "busy", "2026-09-10T05:00:00Z"), // before the 14-day window (19 Sep – 2 Oct)
  ]);
  await Callback.create([
    { campaignId, contactId: b._id, callerId: nimali._id, dueAt: new Date("2026-10-02T03:00:00Z") }, // overdue
    { campaignId, contactId: a._id, callerId: nimali._id, dueAt: new Date("2026-10-03T03:00:00Z"), status: "done" },
  ]);
  await WhatsappLog.create({ campaignId, contactId: a._id, callerId: kasun._id });
});

it("summarises each caller, with today in Sri Lanka time", async () => {
  const rows = await callerPerformance(campaignId, now);
  expect(rows.find((r) => r.name === "Nimali")).toMatchObject({
    target: 25, callsToday: 2, reachedToday: 1, calls: 3, reached: 2,
    contacts: 2, open: 1, interested: 1, enrolled: 1, pendingCallbacks: 1, overdueCallbacks: 1, whatsapp: 0,
  });
  expect(rows.find((r) => r.name === "Kasun")).toMatchObject({ target: 40, callsToday: 0, calls: 1, reached: 0, contacts: 1, whatsapp: 1 });
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
