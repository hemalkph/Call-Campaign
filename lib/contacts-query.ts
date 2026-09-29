// Who can see which campaigns and contacts. Every contact read (table, sheet, export)
// builds its filter here so callers can never see contacts assigned to someone else.
import { type QueryFilter, Types } from "mongoose";
import { z } from "zod";
import { Campaign } from "./models/campaign";
import { Contact, type ContactDoc } from "./models/contact";
import { normalizePhone } from "./phone";
import { objectId } from "./schemas";
import type { CurrentUser } from "./session";
import { OUTCOMES, STAGES } from "./vocab";

export const PAGE_SIZE = 50;
export const SORTS = ["name", "stage", "lastCallAt", "nextCallbackAt", "createdAt"] as const;

// Junk in the URL is ignored, never an error.
export const listParamsSchema = z.object({
  campaign: objectId.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: z.enum(STAGES).optional().catch(undefined),
  caller: z.union([objectId, z.literal("none")]).optional().catch(undefined),
  outcome: z.enum(OUTCOMES).optional().catch(undefined),
  tag: z.string().max(40).optional().catch(undefined),
  district: z.string().max(60).optional().catch(undefined),
  source: z.string().max(80).optional().catch(undefined),
  callback: z.literal("yes").optional().catch(undefined),
  notCalled: z.literal("yes").optional().catch(undefined),
  notMessaged: z.literal("yes").optional().catch(undefined),
  sort: z.enum(SORTS).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ListParams = z.infer<typeof listParamsSchema>;

export function parseListParams(sp: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return listParamsSchema.parse(flat);
}

/** Owners see every campaign; callers only campaigns they're on. */
export function campaignScope(user: CurrentUser) {
  return user.role === "owner" ? {} : { "callers.userId": new Types.ObjectId(user.id) };
}

export async function visibleCampaigns(user: CurrentUser) {
  const list = await Campaign.find(campaignScope(user), { name: 1, status: 1, startDate: 1, callers: 1 })
    .sort({ status: 1, startDate: -1 }) // "active" sorts before "draft"/"ended"
    .lean();
  return list.map((c) => ({ id: String(c._id), name: c.name, status: c.status, callerIds: c.callers.map((x) => String(x.userId)) }));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function contactFilter(user: CurrentUser, campaignId: string, p: Partial<ListParams>): QueryFilter<ContactDoc> {
  const f: QueryFilter<ContactDoc> = { campaignId: new Types.ObjectId(campaignId) };

  if (user.role !== "owner") f.assignedTo = new Types.ObjectId(user.id);
  else if (p.caller) f.assignedTo = p.caller === "none" ? null : new Types.ObjectId(p.caller);

  if (p.q) {
    const rx = new RegExp(escape(p.q), "i");
    const or: QueryFilter<ContactDoc>[] = [{ name: rx }, { school: rx }];
    const digits = p.q.replace(/\D/g, "");
    if (digits.length >= 3) {
      const full = normalizePhone(p.q);
      or.push({ phone: full.ok ? full.phone : { $regex: escape(digits) } });
    }
    f.$or = or;
  }
  if (p.stage) f.stage = p.stage;
  if (p.outcome) f.lastOutcome = p.outcome;
  if (p.tag) f.tags = p.tag;
  if (p.district) f.district = p.district;
  if (p.source !== undefined) f.source = p.source === "(none)" ? { $in: [null, ""] } : p.source;
  if (p.callback) f.nextCallbackAt = { $ne: null };
  if (p.notCalled) f.lastCallAt = null;
  if (p.notMessaged) f.lastWhatsappAt = null;
  return f;
}

export async function listContacts(user: CurrentUser, campaignId: string, p: ListParams) {
  const filter = contactFilter(user, campaignId, p);
  const dir = p.dir === "asc" ? 1 : -1;
  const [rows, total] = await Promise.all([
    Contact.find(filter, { importBatchId: 0 })
      .sort({ [p.sort]: dir, _id: dir })
      .skip((p.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Contact.countDocuments(filter),
  ]);
  return { rows, total };
}

/** Distinct tags / districts for the filter dropdowns, within what this user can see. */
export async function filterOptions(user: CurrentUser, campaignId: string) {
  const base = contactFilter(user, campaignId, {});
  const [tags, districts] = await Promise.all([Contact.distinct("tags", base), Contact.distinct("district", base)]);
  return { tags: (tags as string[]).sort(), districts: (districts as string[]).filter(Boolean).sort() };
}

/** Active campaigns this user calls for, with their personal daily target. */
export async function activeCampaignsFor(user: CurrentUser) {
  const list = await Campaign.find({ status: "active", "callers.userId": new Types.ObjectId(user.id) }).sort({ startDate: -1 }).lean();
  return list.map((c) => ({
    id: String(c._id),
    name: c.name,
    classLabel: c.classLabel,
    startDate: c.startDate,
    fee: c.fee,
    link: c.link,
    script: c.script,
    target: c.callers.find((x) => String(x.userId) === user.id)?.dailyCallTarget ?? c.dailyCallTarget,
  }));
}
export type ActiveCampaign = Awaited<ReturnType<typeof activeCampaignsFor>>[number];
