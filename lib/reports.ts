// Dashboard and report numbers, computed at read time (no background jobs).
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { OPEN_STAGES, REACHED_OUTCOMES } from "./calling";
import { callbacks, calls, campaignCallers, campaigns, contacts, db, users, whatsappLogs } from "./db";
import { dayBounds, TZ } from "./time";
import { STAGES, type Stage } from "./vocab";

/** count(*) filter (where …) as a JS number. */
const countIf = (cond: ReturnType<typeof sql> | undefined) => sql<number>`(count(*) filter (where ${cond}))::int`;

export type CallerRow = {
  callerId: string;
  name: string;
  target: number;
  callsToday: number;
  reachedToday: number;
  calls: number;
  reached: number;
  contacts: number;
  open: number;
  interested: number;
  enrolled: number;
  pendingCallbacks: number;
  overdueCallbacks: number;
  whatsapp: number;
};

export async function callerPerformance(campaignId: string, now = new Date()): Promise<CallerRow[]> {
  const [campaign] = await db.select({ dailyCallTarget: campaigns.dailyCallTarget }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return [];
  const { start } = dayBounds(now);
  const reached = inArray(calls.outcome, REACHED_OUTCOMES);

  const [onCampaign, callRows, contactRows, callbackRows, waRows] = await Promise.all([
    db.select().from(campaignCallers).where(eq(campaignCallers.campaignId, campaignId)).orderBy(asc(campaignCallers.position)),
    db
      .select({
        id: calls.callerId,
        calls: sql<number>`count(*)::int`,
        reached: countIf(reached),
        callsToday: countIf(gte(calls.calledAt, start)),
        reachedToday: countIf(and(gte(calls.calledAt, start), reached)),
      })
      .from(calls)
      .where(eq(calls.campaignId, campaignId))
      .groupBy(calls.callerId),
    db
      .select({
        id: contacts.assignedTo,
        contacts: sql<number>`count(*)::int`,
        open: countIf(inArray(contacts.stage, OPEN_STAGES)),
        interested: countIf(inArray(contacts.stage, ["interested", "payment_details_sent"])),
        enrolled: countIf(eq(contacts.stage, "enrolled")),
      })
      .from(contacts)
      .where(eq(contacts.campaignId, campaignId))
      .groupBy(contacts.assignedTo),
    db
      .select({ id: callbacks.callerId, pending: sql<number>`count(*)::int`, overdue: countIf(lt(callbacks.dueAt, now)) })
      .from(callbacks)
      .where(and(eq(callbacks.campaignId, campaignId), eq(callbacks.status, "pending")))
      .groupBy(callbacks.callerId),
    db
      .select({ id: whatsappLogs.callerId, n: sql<number>`count(*)::int` })
      .from(whatsappLogs)
      .where(eq(whatsappLogs.campaignId, campaignId))
      .groupBy(whatsappLogs.callerId),
  ]);

  // Callers on the campaign, plus anyone removed from it who still has calls or contacts.
  const ids = [
    ...new Set([...onCampaign.map((c) => c.userId), ...callRows.map((c) => c.id), ...contactRows.flatMap((c) => (c.id ? [c.id] : []))]),
  ];
  const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const find = <T extends { id: string | null }>(rows: T[], id: string) => rows.find((r) => r.id === id);

  return ids.map((id) => {
    const cl = find(callRows, id);
    const ct = find(contactRows, id);
    const cb = find(callbackRows, id);
    const member = onCampaign.find((c) => c.userId === id);
    return {
      callerId: id,
      name: names.find((u) => u.id === id)?.name ?? "Unknown",
      target: member ? (member.dailyCallTarget ?? campaign.dailyCallTarget) : 0,
      callsToday: cl?.callsToday ?? 0,
      reachedToday: cl?.reachedToday ?? 0,
      calls: cl?.calls ?? 0,
      reached: cl?.reached ?? 0,
      contacts: ct?.contacts ?? 0,
      open: ct?.open ?? 0,
      interested: ct?.interested ?? 0,
      enrolled: ct?.enrolled ?? 0,
      pendingCallbacks: cb?.pending ?? 0,
      overdueCallbacks: cb?.overdue ?? 0,
      whatsapp: find(waRows, id)?.n ?? 0,
    };
  });
}

export async function stageCounts(campaignId: string): Promise<Record<Stage, number>> {
  const rows = await db
    .select({ stage: contacts.stage, n: count() })
    .from(contacts)
    .where(eq(contacts.campaignId, campaignId))
    .groupBy(contacts.stage);
  return Object.fromEntries(STAGES.map((s) => [s, rows.find((r) => r.stage === s)?.n ?? 0])) as Record<Stage, number>;
}

export async function topSources(campaignId: string, limit = 8) {
  return db
    .select({ source: contacts.source, total: sql<number>`count(*)::int`, enrolled: countIf(eq(contacts.stage, "enrolled")) })
    .from(contacts)
    .where(eq(contacts.campaignId, campaignId))
    .groupBy(contacts.source)
    .orderBy(desc(sql`count(*)`), asc(contacts.source))
    .limit(limit);
}

/** Calls per Sri Lankan day for the last `days` days (oldest first), split into reached / not reached. */
export async function dailyCalls(campaignId: string, days = 14, now = new Date()) {
  const { start } = dayBounds(now);
  const from = new Date(start.getTime() - (days - 1) * 86_400_000);
  const day = sql<string>`to_char(${calls.calledAt} at time zone ${sql.raw(`'${TZ}'`)}, 'YYYY-MM-DD')`; // literal: GROUP BY must match it exactly
  const rows = await db
    .select({ day, total: sql<number>`count(*)::int`, reached: countIf(inArray(calls.outcome, REACHED_OUTCOMES)) })
    .from(calls)
    .where(and(eq(calls.campaignId, campaignId), gte(calls.calledAt, from)))
    .groupBy(day);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getTime() + i * 86_400_000 + 12 * 3600_000).toLocaleDateString("en-CA", { timeZone: TZ });
    const r = rows.find((x) => x.day === d);
    return { day: d, reached: r?.reached ?? 0, notReached: (r?.total ?? 0) - (r?.reached ?? 0) };
  });
}
