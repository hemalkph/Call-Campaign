"use server";

import { and, arrayContains, desc, eq, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { campaignScope } from "@/lib/contacts-query";
import { callbacks, calls, campaignCallers, campaigns, contacts, db, users, whatsappLogs } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/tx";
import { bulkContactsSchema, createContactSchema, recordId, updateContactSchema } from "@/lib/schemas";
import { type CurrentUser, requireOwner, requireUser } from "@/lib/session";
import { STAGES } from "@/lib/vocab";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DUPLICATE = "This phone number is already in this campaign.";
const NOT_ON_CAMPAIGN = "That caller isn't on this campaign.";
const setStageSchema = z.strictObject({ id: recordId, stage: z.enum(STAGES) });

/** Contacts a user may see and edit: all for owners, their own for callers. */
const mine = (user: CurrentUser) => (user.role === "owner" ? undefined : eq(contacts.assignedTo, user.id));

const isCampaignCaller = async (campaignId: string, userId: string) =>
  (
    await db
      .select({ x: sql`1` })
      .from(campaignCallers)
      .where(and(eq(campaignCallers.campaignId, campaignId), eq(campaignCallers.userId, userId)))
      .limit(1)
  ).length > 0;

/** Owners pick any caller on the campaign ("" = unassigned); callers always get the contact themselves. */
async function resolveAssignee(user: CurrentUser, campaignId: string, requested: string | undefined) {
  if (user.role !== "owner") return { ok: true as const, value: user.id };
  if (!requested) return { ok: true as const, value: null };
  return (await isCampaignCaller(campaignId, requested)) ? { ok: true as const, value: requested } : { ok: false as const };
}

async function otherCampaignNames(user: CurrentUser, phone: string, campaignId: string) {
  const others = await db
    .selectDistinct({ name: campaigns.name })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(and(eq(contacts.phone, phone), ne(contacts.campaignId, campaignId)));
  if (!others.length) return undefined;
  if (user.role !== "owner") return "This number is also in another campaign.";
  return `This number is also in: ${others.map((c) => c.name).join(", ")}.`;
}

export async function createContact(input: unknown): Promise<Result<{ id: string; warning?: string }>> {
  const user = await requireUser();
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { campaignId, assignedTo, stage: _ignored, ...fields } = parsed.data; // eslint-disable-line @typescript-eslint/no-unused-vars

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), campaignScope(user)));
  if (!campaign) return { ok: false, error: "Campaign not found." };
  const assignee = await resolveAssignee(user, campaignId, assignedTo);
  if (!assignee.ok) return { ok: false, error: NOT_ON_CAMPAIGN };

  try {
    const [contact] = await db
      .insert(contacts)
      .values({ ...fields, altPhone: fields.altPhone ?? null, campaignId, assignedTo: assignee.value })
      .returning({ id: contacts.id });
    revalidatePath("/contacts");
    return { ok: true, id: contact.id, warning: await otherCampaignNames(user, fields.phone, campaignId) };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }
}

export async function updateContact(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, assignedTo, stage, ...fields } = parsed.data;

  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, id), mine(user)));
  if (!contact) return { ok: false, error: "Contact not found." };

  const changes: Partial<typeof contacts.$inferInsert> = { ...fields, altPhone: fields.altPhone ?? null };
  if (stage && stage !== contact.stage) Object.assign(changes, { stage, stageChangedAt: new Date() });
  if (user.role === "owner" && assignedTo !== undefined && assignedTo !== (contact.assignedTo ?? "")) {
    const assignee = await resolveAssignee(user, contact.campaignId, assignedTo);
    if (!assignee.ok) return { ok: false, error: NOT_ON_CAMPAIGN };
    changes.assignedTo = assignee.value;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(contacts).set(changes).where(eq(contacts.id, id));
      const base = { actorId: user.id, entity: "contacts", entityId: id };
      if (changes.stage)
        await audit({ ...base, action: "contact.stage", before: { stage: contact.stage }, after: { stage: changes.stage } }, tx);
      if (changes.assignedTo !== undefined) {
        await tx.update(callbacks).set({ callerId: changes.assignedTo }).where(and(eq(callbacks.contactId, id), eq(callbacks.status, "pending")));
        await audit(
          { ...base, action: "contact.reassign", before: { assignedTo: contact.assignedTo }, after: { assignedTo: changes.assignedTo } },
          tx,
        );
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }

  revalidatePath("/contacts");
  return { ok: true };
}

export async function bulkUpdateContacts(input: unknown): Promise<Result<{ changed: number }>> {
  const me = await requireOwner();
  const parsed = bulkContactsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const p = parsed.data;
  const selected = inArray(contacts.id, p.ids);

  const changed = await db.transaction(async (tx) => {
    if (p.action === "reassign") {
      const to = p.assignedTo || null;
      if (to) {
        // Every selected contact's campaign must have this caller on it.
        const missing = await tx
          .selectDistinct({ campaignId: contacts.campaignId })
          .from(contacts)
          .leftJoin(campaignCallers, and(eq(campaignCallers.campaignId, contacts.campaignId), eq(campaignCallers.userId, to)))
          .where(and(selected, isNull(campaignCallers.userId)));
        if (missing.length) return null;
      }
      const moving = await tx
        .select({ id: contacts.id, assignedTo: contacts.assignedTo })
        .from(contacts)
        .where(and(selected, to ? or(isNull(contacts.assignedTo), ne(contacts.assignedTo, to)) : sql`${contacts.assignedTo} is not null`));
      if (!moving.length) return 0;
      const ids = moving.map((c) => c.id);
      await tx.update(contacts).set({ assignedTo: to }).where(inArray(contacts.id, ids));
      await tx.update(callbacks).set({ callerId: to }).where(and(inArray(callbacks.contactId, ids), eq(callbacks.status, "pending")));
      await audit(
        {
          actorId: me.id,
          action: "contact.bulk_reassign",
          entity: "contacts",
          before: { assignedTo: Object.fromEntries(moving.map((c) => [c.id, c.assignedTo])) },
          after: { assignedTo: to },
        },
        tx,
      );
      return moving.length;
    }
    if (p.action === "stage") {
      const moving = await tx
        .select({ id: contacts.id, stage: contacts.stage })
        .from(contacts)
        .where(and(selected, ne(contacts.stage, p.stage)));
      if (!moving.length) return 0;
      await tx
        .update(contacts)
        .set({ stage: p.stage, stageChangedAt: new Date() })
        .where(inArray(contacts.id, moving.map((c) => c.id)));
      await audit(
        {
          actorId: me.id,
          action: "contact.bulk_stage",
          entity: "contacts",
          before: { stage: Object.fromEntries(moving.map((c) => [c.id, c.stage])) },
          after: { stage: p.stage },
        },
        tx,
      );
      return moving.length;
    }
    const tagged = await tx
      .update(contacts)
      .set({ tags: sql`array_append(${contacts.tags}, ${p.tag})` })
      .where(and(selected, not(arrayContains(contacts.tags, [p.tag]))))
      .returning({ id: contacts.id });
    return tagged.length;
  });
  if (changed === null) return { ok: false, error: NOT_ON_CAMPAIGN };

  revalidatePath("/contacts");
  return { ok: true, changed };
}

export type Activity = {
  calls: { id: string; at: string; outcome: string; notes: string; durationSec?: number; caller: string }[];
  whatsapp: { id: string; at: string; template: string; caller: string }[];
  callbacks: { id: string; dueAt: string; status: string; note: string; reason: string }[];
};

/** Call history, WhatsApp log and callbacks for the contact sheet. */
export async function getContactActivity(input: unknown): Promise<Result<{ activity: Activity }>> {
  const user = await requireUser();
  const id = recordId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const [contact] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id.data), mine(user)));
  if (!contact) return { ok: false, error: "Contact not found." };

  const [callRows, logRows, callbackRows] = await Promise.all([
    db
      .select({ c: calls, caller: users.name })
      .from(calls)
      .leftJoin(users, eq(users.id, calls.callerId))
      .where(eq(calls.contactId, id.data))
      .orderBy(desc(calls.calledAt))
      .limit(100),
    db
      .select({ l: whatsappLogs, caller: users.name })
      .from(whatsappLogs)
      .leftJoin(users, eq(users.id, whatsappLogs.callerId))
      .where(eq(whatsappLogs.contactId, id.data))
      .orderBy(desc(whatsappLogs.sentAt))
      .limit(100),
    db.select().from(callbacks).where(eq(callbacks.contactId, id.data)).orderBy(desc(callbacks.dueAt)).limit(50),
  ]);
  return {
    ok: true,
    activity: {
      calls: callRows.map(({ c, caller }) => ({
        id: c.id,
        at: c.calledAt.toISOString(),
        outcome: c.outcome,
        notes: c.notes,
        durationSec: c.durationSec ?? undefined,
        caller: caller ?? "",
      })),
      whatsapp: logRows.map(({ l, caller }) => ({ id: l.id, at: l.sentAt.toISOString(), template: l.templateName, caller: caller ?? "" })),
      callbacks: callbackRows.map((c) => ({
        id: c.id,
        dueAt: c.dueAt.toISOString(),
        status: c.status,
        note: c.note,
        reason: c.history.findLast((h) => h.action === "cancelled")?.reason ?? "",
      })),
    },
  };
}

/** Pipeline board: move one contact to another stage. */
export async function setContactStage(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const p = setStageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ stage: contacts.stage })
      .from(contacts)
      .where(and(eq(contacts.id, p.data.id), ne(contacts.stage, p.data.stage)))
      .for("update");
    if (!before) return; // already there
    await tx.update(contacts).set({ stage: p.data.stage, stageChangedAt: new Date() }).where(eq(contacts.id, p.data.id));
    await audit(
      {
        actorId: me.id,
        action: "contact.stage",
        entity: "contacts",
        entityId: p.data.id,
        before: { stage: before.stage },
        after: { stage: p.data.stage, via: "pipeline" },
      },
      tx,
    );
  });
  revalidatePath("/pipeline");
  return { ok: true };
}
