"use server";

import { Types } from "mongoose";
import { z } from "zod";
import { contactFilter, listParamsSchema } from "@/lib/contacts-query";
import { audit } from "@/lib/models/audit-event";
import { Call } from "@/lib/models/call";
import { Callback } from "@/lib/models/callback";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { User } from "@/lib/models/user";
import { WhatsappLog } from "@/lib/models/whatsapp-log";
import { callerPerformance } from "@/lib/reports";
import { EXPORT_TYPES, type ExportRow } from "@/lib/vocab";
import { objectId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

const EXPORT_PAGE = 2000; // keeps each response well under Vercel's limits

const schema = z.strictObject({
  type: z.enum(EXPORT_TYPES),
  campaignId: objectId,
  params: z.record(z.string(), z.unknown()),
  page: z.number().int().min(0).max(1000),
  format: z.enum(["csv", "xlsx"]),
});

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * One page of an export for the current (filtered) contacts view. Logs, callbacks and calls are
 * limited to the contacts that match the filters. The browser builds the file.
 */
export async function exportPage(input: unknown) {
  const me = await requireOwner();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const { type, campaignId, page, format } = p.data;
  const params = listParamsSchema.parse(p.data.params);

  const campaign = await Campaign.findById(campaignId, { name: 1 }).lean();
  if (!campaign) return { ok: false as const, error: "Campaign not found." };
  const filter = contactFilter(me, campaignId, params);
  const { page: _p, sort: _s, dir: _d, campaign: _c, q, ...filters } = params; // eslint-disable-line @typescript-eslint/no-unused-vars
  const filtered = !!q || Object.values(filters).some((v) => v !== undefined);

  const users = await User.find({}, { name: 1 }).lean();
  const userName = (id: unknown) => (id ? (users.find((u) => String(u._id) === String(id))?.name ?? "") : "");

  let rows: ExportRow[] = [];
  let total: number | undefined;
  let more = false;

  if (type === "performance") {
    rows = (await callerPerformance(campaignId)).map(({ callerId: _id, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    total = rows.length;
  } else if (type === "contacts") {
    const [docs, count] = await Promise.all([
      Contact.find(filter).sort({ createdAt: 1, _id: 1 }).skip(page * EXPORT_PAGE).limit(EXPORT_PAGE).lean(),
      page === 0 ? Contact.countDocuments(filter) : Promise.resolve(undefined),
    ]);
    total = count;
    more = docs.length === EXPORT_PAGE;
    rows = docs.map((c) => ({
      name: c.name,
      phone: c.phone,
      altPhone: c.altPhone ?? "",
      school: c.school ?? "",
      district: c.district ?? "",
      gradeOrBatch: c.gradeOrBatch ?? "",
      source: c.source ?? "",
      tags: c.tags.join(", "),
      stage: c.stage,
      caller: userName(c.assignedTo),
      lastCallAt: iso(c.lastCallAt),
      lastOutcome: c.lastOutcome ?? null,
      nextCallbackAt: iso(c.nextCallbackAt),
      lastWhatsappAt: iso(c.lastWhatsappAt),
      notes: c.notes,
      createdAt: iso(c.createdAt),
    }));
  } else {
    // Only the contacts in view. Without filters, the whole campaign (no big $in list needed).
    const scope = filtered
      ? { contactId: { $in: (await Contact.distinct("_id", filter)) as Types.ObjectId[] } }
      : { campaignId: new Types.ObjectId(campaignId) };
    const model = { calls: Call, whatsapp: WhatsappLog, callbacks: Callback }[type] as typeof Call;
    const dateField = { calls: "calledAt", whatsapp: "sentAt", callbacks: "dueAt" }[type];
    const [docs, count] = await Promise.all([
      model.find(scope).sort({ [dateField]: 1, _id: 1 }).skip(page * EXPORT_PAGE).limit(EXPORT_PAGE).lean(),
      page === 0 ? model.countDocuments(scope) : Promise.resolve(undefined),
    ]);
    total = count;
    more = docs.length === EXPORT_PAGE;
    const contacts = await Contact.find({ _id: { $in: docs.map((d) => d.contactId) } }, { name: 1, phone: 1 }).lean();
    const who = (id: unknown) => contacts.find((c) => String(c._id) === String(id));
    rows = (docs as unknown as Record<string, unknown>[]).map((d) => {
      const c = who(d.contactId);
      const base = { contact: c?.name ?? "", phone: c?.phone ?? "", caller: userName(d.callerId) };
      if (type === "calls")
        return { ...base, calledAt: iso(d.calledAt as Date), outcome: d.outcome as string, durationSec: (d.durationSec as number) ?? null, notes: d.notes as string };
      if (type === "whatsapp") return { ...base, sentAt: iso(d.sentAt as Date), template: d.templateName as string, note: d.note as string };
      const history = (d.history as { action: string; reason?: string }[]) ?? [];
      return {
        ...base,
        dueAt: iso(d.dueAt as Date),
        status: d.status as string,
        note: d.note as string,
        reason: history.findLast((h) => h.action === "cancelled")?.reason ?? "",
        createdAt: iso(d.createdAt as Date),
      };
    });
  }

  if (page === 0)
    await audit({
      actorId: me.id,
      action: `export.${type}`,
      entity: "campaigns",
      entityId: campaignId,
      after: { format, rows: total, filters: { ...filters, search: q ? "yes" : undefined } }, // not the search text: it may be a phone number
    });

  return { ok: true as const, rows, total, campaignName: campaign.name, more };
}
