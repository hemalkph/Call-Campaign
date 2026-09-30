// Who can see which campaigns and contacts. Every contact read (table, sheet, export)
// builds its filter here so callers can never see contacts assigned to someone else.
import { and, arrayContains, asc, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { campaignCallers, campaigns, contacts, db } from "./db";
import { normalizePhone } from "./phone";
import { recordId } from "./schemas";
import type { CurrentUser } from "./session";
import { OUTCOMES, STAGES } from "./vocab";

export const PAGE_SIZE = 50;
export const SORTS = ["name", "stage", "lastCallAt", "nextCallbackAt", "createdAt"] as const;

// Junk in the URL is ignored, never an error.
export const listParamsSchema = z.object({
  campaign: recordId.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: z.enum(STAGES).optional().catch(undefined),
  caller: z.union([recordId, z.literal("none")]).optional().catch(undefined),
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
export function campaignScope(user: CurrentUser): SQL | undefined {
  if (user.role === "owner") return undefined;
  return exists(
    db
      .select({ x: sql`1` })
      .from(campaignCallers)
      .where(and(eq(campaignCallers.campaignId, campaigns.id), eq(campaignCallers.userId, user.id))),
  );
}

/** Caller ids per campaign, in the owner's chosen order. */
export async function callersOf(campaignIds: string[]) {
  const rows = campaignIds.length
    ? await db
        .select()
        .from(campaignCallers)
        .where(inArray(campaignCallers.campaignId, campaignIds))
        .orderBy(asc(campaignCallers.position))
    : [];
  return (id: string) => rows.filter((r) => r.campaignId === id);
}

export async function visibleCampaigns(user: CurrentUser) {
  const list = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
    .from(campaigns)
    .where(campaignScope(user))
    .orderBy(asc(campaigns.status), desc(campaigns.startDate)); // "active" sorts before "draft"/"ended"
  const callers = await callersOf(list.map((c) => c.id));
  return list.map((c) => ({ ...c, callerIds: callers(c.id).map((x) => x.userId) }));
}

/** Escapes % _ \ so user search text is matched literally by ILIKE. */
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export function contactFilter(user: CurrentUser, campaignId: string, p: Partial<ListParams>): SQL {
  const f: (SQL | undefined)[] = [eq(contacts.campaignId, campaignId)];

  if (user.role !== "owner") f.push(eq(contacts.assignedTo, user.id));
  else if (p.caller) f.push(p.caller === "none" ? isNull(contacts.assignedTo) : eq(contacts.assignedTo, p.caller));

  if (p.q) {
    const text = like(p.q);
    const any: SQL[] = [ilike(contacts.name, text), ilike(contacts.school, text)];
    const digits = p.q.replace(/\D/g, "");
    if (digits.length >= 3) {
      const full = normalizePhone(p.q);
      any.push(full.ok ? eq(contacts.phone, full.phone) : ilike(contacts.phone, like(digits)));
    }
    f.push(or(...any));
  }
  if (p.stage) f.push(eq(contacts.stage, p.stage));
  if (p.outcome) f.push(eq(contacts.lastOutcome, p.outcome));
  if (p.tag) f.push(arrayContains(contacts.tags, [p.tag]));
  if (p.district) f.push(eq(contacts.district, p.district));
  if (p.source !== undefined) f.push(eq(contacts.source, p.source === "(none)" ? "" : p.source));
  if (p.callback) f.push(isNotNull(contacts.nextCallbackAt));
  if (p.notCalled) f.push(isNull(contacts.lastCallAt));
  if (p.notMessaged) f.push(isNull(contacts.lastWhatsappAt));
  return and(...f)!;
}

const SORT_COLUMN = {
  name: contacts.name,
  stage: contacts.stage,
  lastCallAt: contacts.lastCallAt,
  nextCallbackAt: contacts.nextCallbackAt,
  createdAt: contacts.createdAt,
} as const;

export async function listContacts(user: CurrentUser, campaignId: string, p: ListParams) {
  const where = contactFilter(user, campaignId, p);
  const col = SORT_COLUMN[p.sort];
  const order = p.dir === "asc" ? [sql`${col} asc nulls last`, asc(contacts.id)] : [sql`${col} desc nulls last`, desc(contacts.id)];
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(contacts).where(where),
  ]);
  return { rows, total };
}

/** Distinct tags / districts for the filter dropdowns, within what this user can see. */
export async function filterOptions(user: CurrentUser, campaignId: string) {
  const base = contactFilter(user, campaignId, {});
  const [tags, districts] = await Promise.all([
    db.selectDistinct({ v: sql<string>`unnest(${contacts.tags})` }).from(contacts).where(base),
    db.selectDistinct({ v: contacts.district }).from(contacts).where(and(base, ne(contacts.district, ""))),
  ]);
  const sorted = (rows: { v: string }[]) => rows.map((r) => r.v).sort((a, b) => a.localeCompare(b));
  return { tags: sorted(tags), districts: sorted(districts) };
}

/** Active campaigns this user calls for, with their personal daily target. */
export async function activeCampaignsFor(user: CurrentUser) {
  const list = await db
    .select({ c: campaigns, ownTarget: campaignCallers.dailyCallTarget })
    .from(campaigns)
    .innerJoin(campaignCallers, and(eq(campaignCallers.campaignId, campaigns.id), eq(campaignCallers.userId, user.id)))
    .where(eq(campaigns.status, "active"))
    .orderBy(desc(campaigns.startDate));
  return list.map(({ c, ownTarget }) => ({
    id: c.id,
    name: c.name,
    classLabel: c.classLabel,
    startDate: c.startDate,
    fee: c.fee,
    link: c.link,
    script: c.script,
    target: ownTarget ?? c.dailyCallTarget,
  }));
}
export type ActiveCampaign = Awaited<ReturnType<typeof activeCampaignsFor>>[number];
