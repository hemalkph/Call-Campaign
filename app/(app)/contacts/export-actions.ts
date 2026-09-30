"use server";

import { asc, count, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { contactFilter, listParamsSchema } from "@/lib/contacts-query";
import { callbacks, calls, campaigns, contacts, db, users, whatsappLogs } from "@/lib/db";
import { callerPerformance } from "@/lib/reports";
import { recordId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";
import { EXPORT_TYPES, type ExportRow } from "@/lib/vocab";

const EXPORT_PAGE = 2000; // keeps each response well under hosting limits

const schema = z.strictObject({
  type: z.enum(EXPORT_TYPES),
  campaignId: recordId,
  params: z.record(z.string(), z.unknown()),
  page: z.number().int().min(0).max(1000),
  format: z.enum(["csv", "xlsx"]),
});

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const caller = alias(users, "caller");

/**
 * One page of an export for the current (filtered) contacts view. Calls, WhatsApp logs and
 * callbacks are limited to the contacts that match the filters. The browser builds the file.
 */
export async function exportPage(input: unknown) {
  const me = await requireOwner();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const { type, campaignId, page, format } = p.data;
  const params = listParamsSchema.parse(p.data.params);

  const [campaign] = await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { ok: false as const, error: "Campaign not found." };
  const filter = contactFilter(me, campaignId, params);
  const { page: _p, sort: _s, dir: _d, campaign: _c, q, ...filters } = params; // eslint-disable-line @typescript-eslint/no-unused-vars
  const offset = page * EXPORT_PAGE;

  let rows: ExportRow[] = [];
  let total: number | undefined;

  if (type === "performance") {
    rows = (await callerPerformance(campaignId)).map(({ callerId: _id, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    total = rows.length;
  } else if (type === "contacts") {
    const docs = await db
      .select({ c: contacts, caller: caller.name })
      .from(contacts)
      .leftJoin(caller, eq(caller.id, contacts.assignedTo))
      .where(filter)
      .orderBy(asc(contacts.createdAt), asc(contacts.id))
      .limit(EXPORT_PAGE)
      .offset(offset);
    if (page === 0) [{ total }] = await db.select({ total: count() }).from(contacts).where(filter);
    rows = docs.map(({ c, caller }) => ({
      name: c.name,
      phone: c.phone,
      altPhone: c.altPhone ?? "",
      school: c.school,
      district: c.district,
      gradeOrBatch: c.gradeOrBatch,
      source: c.source,
      tags: c.tags.join(", "),
      stage: c.stage,
      caller: caller ?? "",
      lastCallAt: iso(c.lastCallAt),
      lastOutcome: c.lastOutcome,
      nextCallbackAt: iso(c.nextCallbackAt),
      lastWhatsappAt: iso(c.lastWhatsappAt),
      notes: c.notes,
      createdAt: iso(c.createdAt),
    }));
  } else if (type === "calls") {
    const docs = await db
      .select({ r: calls, contact: contacts.name, phone: contacts.phone, caller: caller.name })
      .from(calls)
      .innerJoin(contacts, eq(contacts.id, calls.contactId))
      .leftJoin(caller, eq(caller.id, calls.callerId))
      .where(filter)
      .orderBy(asc(calls.calledAt), asc(calls.id))
      .limit(EXPORT_PAGE)
      .offset(offset);
    if (page === 0)
      [{ total }] = await db.select({ total: count() }).from(calls).innerJoin(contacts, eq(contacts.id, calls.contactId)).where(filter);
    rows = docs.map(({ r, contact, phone, caller }) => ({
      contact,
      phone,
      caller: caller ?? "",
      calledAt: iso(r.calledAt),
      outcome: r.outcome,
      durationSec: r.durationSec,
      notes: r.notes,
    }));
  } else if (type === "whatsapp") {
    const docs = await db
      .select({ r: whatsappLogs, contact: contacts.name, phone: contacts.phone, caller: caller.name })
      .from(whatsappLogs)
      .innerJoin(contacts, eq(contacts.id, whatsappLogs.contactId))
      .leftJoin(caller, eq(caller.id, whatsappLogs.callerId))
      .where(filter)
      .orderBy(asc(whatsappLogs.sentAt), asc(whatsappLogs.id))
      .limit(EXPORT_PAGE)
      .offset(offset);
    if (page === 0)
      [{ total }] = await db
        .select({ total: count() })
        .from(whatsappLogs)
        .innerJoin(contacts, eq(contacts.id, whatsappLogs.contactId))
        .where(filter);
    rows = docs.map(({ r, contact, phone, caller }) => ({
      contact,
      phone,
      caller: caller ?? "",
      sentAt: iso(r.sentAt),
      template: r.templateName,
      note: r.note,
    }));
  } else {
    const docs = await db
      .select({ r: callbacks, contact: contacts.name, phone: contacts.phone, caller: caller.name })
      .from(callbacks)
      .innerJoin(contacts, eq(contacts.id, callbacks.contactId))
      .leftJoin(caller, eq(caller.id, callbacks.callerId))
      .where(filter)
      .orderBy(asc(callbacks.dueAt), asc(callbacks.id))
      .limit(EXPORT_PAGE)
      .offset(offset);
    if (page === 0)
      [{ total }] = await db.select({ total: count() }).from(callbacks).innerJoin(contacts, eq(contacts.id, callbacks.contactId)).where(filter);
    rows = docs.map(({ r, contact, phone, caller }) => ({
      contact,
      phone,
      caller: caller ?? "",
      dueAt: iso(r.dueAt),
      status: r.status,
      note: r.note,
      reason: r.history.findLast((h) => h.action === "cancelled")?.reason ?? "",
      createdAt: iso(r.createdAt),
    }));
  }

  if (page === 0)
    await audit({
      actorId: me.id,
      action: `export.${type}`,
      entity: "campaigns",
      entityId: campaignId,
      after: { format, rows: total, filters: { ...filters, search: q ? "yes" : undefined } }, // not the search text: it may be a phone number
    });

  return { ok: true as const, rows, total, campaignName: campaign.name, more: type !== "performance" && rows.length === EXPORT_PAGE };
}
