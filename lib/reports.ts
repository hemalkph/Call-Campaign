// Dashboard and report numbers, computed at read time (no background jobs).
import { Types } from "mongoose";
import { OPEN_STAGES, REACHED_OUTCOMES } from "./calling";
import { Call } from "./models/call";
import { Callback } from "./models/callback";
import { Campaign } from "./models/campaign";
import { Contact } from "./models/contact";
import { User } from "./models/user";
import { WhatsappLog } from "./models/whatsapp-log";
import { dayBounds, TZ } from "./time";
import { STAGES, type Stage } from "./vocab";

const oid = (id: string) => new Types.ObjectId(id);
type Counted = { _id: Types.ObjectId | null; [k: string]: unknown };
const byId = <T extends Counted>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
const reached = { $cond: [{ $in: ["$outcome", REACHED_OUTCOMES] }, 1, 0] };

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
  const campaign = await Campaign.findById(campaignId, { callers: 1, dailyCallTarget: 1 }).lean();
  if (!campaign) return [];
  const cid = oid(campaignId);
  const { start } = dayBounds(now);

  const [calls, contacts, callbacks, whatsapp] = await Promise.all([
    Call.aggregate<Counted & { calls: number; reached: number; callsToday: number; reachedToday: number }>([
      { $match: { campaignId: cid } },
      {
        $group: {
          _id: "$callerId",
          calls: { $sum: 1 },
          reached: { $sum: reached },
          callsToday: { $sum: { $cond: [{ $gte: ["$calledAt", start] }, 1, 0] } },
          reachedToday: { $sum: { $cond: [{ $and: [{ $gte: ["$calledAt", start] }, { $in: ["$outcome", REACHED_OUTCOMES] }] }, 1, 0] } },
        },
      },
    ]),
    Contact.aggregate<Counted & { contacts: number; open: number; interested: number; enrolled: number }>([
      { $match: { campaignId: cid } },
      {
        $group: {
          _id: "$assignedTo",
          contacts: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ["$stage", OPEN_STAGES] }, 1, 0] } },
          interested: { $sum: { $cond: [{ $in: ["$stage", ["interested", "payment_details_sent"]] }, 1, 0] } },
          enrolled: { $sum: { $cond: [{ $eq: ["$stage", "enrolled"] }, 1, 0] } },
        },
      },
    ]),
    Callback.aggregate<Counted & { pending: number; overdue: number }>([
      { $match: { campaignId: cid, status: "pending" } },
      { $group: { _id: "$callerId", pending: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ["$dueAt", now] }, 1, 0] } } } },
    ]),
    WhatsappLog.aggregate<Counted & { n: number }>([{ $match: { campaignId: cid } }, { $group: { _id: "$callerId", n: { $sum: 1 } } }]),
  ]);

  // Callers on the campaign, plus anyone removed from it who still has calls or contacts.
  const ids = [...new Set([...campaign.callers.map((c) => String(c.userId)), ...calls.map((c) => String(c._id)), ...contacts.filter((c) => c._id).map((c) => String(c._id))])];
  const users = await User.find({ _id: { $in: ids } }, { name: 1 }).lean();
  const [callMap, contactMap, cbMap, waMap] = [byId(calls), byId(contacts), byId(callbacks), byId(whatsapp)];

  return ids.map((id) => {
    const cl = callMap.get(id);
    const ct = contactMap.get(id);
    const cb = cbMap.get(id);
    const onCampaign = campaign.callers.find((c) => String(c.userId) === id);
    return {
      callerId: id,
      name: users.find((u) => String(u._id) === id)?.name ?? "Unknown",
      target: onCampaign ? (onCampaign.dailyCallTarget ?? campaign.dailyCallTarget) : 0,
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
      whatsapp: waMap.get(id)?.n ?? 0,
    };
  });
}

export async function stageCounts(campaignId: string): Promise<Record<Stage, number>> {
  const rows = await Contact.aggregate<{ _id: Stage; n: number }>([
    { $match: { campaignId: oid(campaignId) } },
    { $group: { _id: "$stage", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(STAGES.map((s) => [s, rows.find((r) => r._id === s)?.n ?? 0])) as Record<Stage, number>;
}

export async function topSources(campaignId: string, limit = 8) {
  const rows = await Contact.aggregate<{ _id: string | null; total: number; enrolled: number }>([
    { $match: { campaignId: oid(campaignId) } },
    { $group: { _id: { $ifNull: ["$source", ""] }, total: { $sum: 1 }, enrolled: { $sum: { $cond: [{ $eq: ["$stage", "enrolled"] }, 1, 0] } } } },
    { $sort: { total: -1, _id: 1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({ source: r._id || "", total: r.total, enrolled: r.enrolled }));
}

/** Calls per Sri Lankan day for the last `days` days (oldest first), split into reached / not reached. */
export async function dailyCalls(campaignId: string, days = 14, now = new Date()) {
  const { start } = dayBounds(now);
  const from = new Date(start.getTime() - (days - 1) * 86_400_000);
  const rows = await Call.aggregate<{ _id: string; total: number; reached: number }>([
    { $match: { campaignId: oid(campaignId), calledAt: { $gte: from } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$calledAt", timezone: TZ } }, total: { $sum: 1 }, reached: { $sum: reached } } },
  ]);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 86_400_000 + 12 * 3600_000).toLocaleDateString("en-CA", { timeZone: TZ });
    const r = rows.find((x) => x._id === day);
    return { day, reached: r?.reached ?? 0, notReached: (r?.total ?? 0) - (r?.reached ?? 0) };
  });
}
