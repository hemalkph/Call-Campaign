"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { campaignScope } from "@/lib/contacts-query";
import { audit } from "@/lib/models/audit-event";
import { Callback } from "@/lib/models/callback";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { Call } from "@/lib/models/call";
import { User } from "@/lib/models/user";
import { WhatsappLog } from "@/lib/models/whatsapp-log";
import { z } from "zod";
import { bulkContactsSchema, createContactSchema, objectId, updateContactSchema } from "@/lib/schemas";
import { STAGES } from "@/lib/vocab";

const setStageSchema = z.strictObject({ id: objectId, stage: z.enum(STAGES) });
import { type CurrentUser, requireOwner, requireUser } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DUPLICATE = "This phone number is already in this campaign.";
const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;
const oid = (id: string) => new Types.ObjectId(id);

/** Owners pick any caller on the campaign ("" = unassigned); callers always get the contact themselves. */
async function resolveAssignee(user: CurrentUser, campaignId: string, requested: string | undefined) {
  if (user.role !== "owner") return { ok: true as const, value: oid(user.id) };
  if (!requested) return { ok: true as const, value: null };
  const onCampaign = await Campaign.exists({ _id: campaignId, "callers.userId": oid(requested) });
  return onCampaign ? { ok: true as const, value: oid(requested) } : { ok: false as const };
}

async function otherCampaignNames(user: CurrentUser, phone: string, campaignId: string) {
  const ids = await Contact.distinct("campaignId", { phone, campaignId: { $ne: oid(campaignId) } });
  if (!ids.length) return undefined;
  if (user.role !== "owner") return "This number is also in another campaign.";
  const names = await Campaign.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return `This number is also in: ${names.map((c) => c.name).join(", ")}.`;
}

export async function createContact(input: unknown): Promise<Result<{ id: string; warning?: string }>> {
  const user = await requireUser();
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { campaignId, assignedTo, stage: _ignored, ...fields } = parsed.data; // eslint-disable-line @typescript-eslint/no-unused-vars

  if (!(await Campaign.exists({ _id: campaignId, ...campaignScope(user) }))) return { ok: false, error: "Campaign not found." };
  const assignee = await resolveAssignee(user, campaignId, assignedTo);
  if (!assignee.ok) return { ok: false, error: "That caller isn't on this campaign." };

  try {
    const contact = await Contact.create({ ...fields, campaignId, assignedTo: assignee.value });
    revalidatePath("/contacts");
    return { ok: true, id: String(contact._id), warning: await otherCampaignNames(user, fields.phone, campaignId) };
  } catch (e) {
    if (isDuplicateKey(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }
}

export async function updateContact(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, assignedTo, stage, ...fields } = parsed.data;

  const contact = await Contact.findOne({ _id: id, ...(user.role === "owner" ? {} : { assignedTo: oid(user.id) }) });
  if (!contact) return { ok: false, error: "Contact not found." };
  const before = { stage: contact.stage, assignedTo: contact.assignedTo ? String(contact.assignedTo) : null };

  contact.set({ ...fields, altPhone: fields.altPhone ?? "" });
  if (stage && stage !== contact.stage) contact.set({ stage, stageChangedAt: new Date() });
  if (user.role === "owner" && assignedTo !== undefined && assignedTo !== (before.assignedTo ?? "")) {
    const assignee = await resolveAssignee(user, String(contact.campaignId), assignedTo);
    if (!assignee.ok) return { ok: false, error: "That caller isn't on this campaign." };
    contact.assignedTo = assignee.value;
  }

  try {
    await contact.save();
  } catch (e) {
    if (isDuplicateKey(e)) return { ok: false, error: DUPLICATE };
    throw e;
  }

  const after = { stage: contact.stage, assignedTo: contact.assignedTo ? String(contact.assignedTo) : null };
  const base = { actorId: user.id, entity: "contacts", entityId: contact._id };
  if (after.stage !== before.stage)
    await audit({ ...base, action: "contact.stage", before: { stage: before.stage }, after: { stage: after.stage } });
  if (after.assignedTo !== before.assignedTo) {
    await Callback.updateMany({ contactId: contact._id, status: "pending" }, { callerId: contact.assignedTo });
    await audit({ ...base, action: "contact.reassign", before: { assignedTo: before.assignedTo }, after: { assignedTo: after.assignedTo } });
  }

  revalidatePath("/contacts");
  return { ok: true };
}

export async function bulkUpdateContacts(input: unknown): Promise<Result<{ changed: number }>> {
  const me = await requireOwner();
  const parsed = bulkContactsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const p = parsed.data;
  const ids = p.ids.map(oid);

  let changed = 0;
  if (p.action === "reassign") {
    // Every selected contact's campaign must have this caller on it.
    const campaignIds = await Contact.distinct("campaignId", { _id: { $in: ids } });
    if (p.assignedTo) {
      const ok = await Campaign.countDocuments({ _id: { $in: campaignIds }, "callers.userId": oid(p.assignedTo) });
      if (ok !== campaignIds.length) return { ok: false, error: "That caller isn't on this campaign." };
    }
    const to = p.assignedTo ? oid(p.assignedTo) : null;
    const moving = await Contact.find({ _id: { $in: ids }, assignedTo: { $ne: to } }, { assignedTo: 1 }).lean();
    changed = (await Contact.updateMany({ _id: { $in: moving.map((c) => c._id) } }, { assignedTo: to })).modifiedCount;
    await Callback.updateMany({ contactId: { $in: moving.map((c) => c._id) }, status: "pending" }, { callerId: to });
    if (changed)
      await audit({
        actorId: me.id,
        action: "contact.bulk_reassign",
        entity: "contacts",
        before: { assignedTo: Object.fromEntries(moving.map((c) => [String(c._id), c.assignedTo ? String(c.assignedTo) : null])) },
        after: { assignedTo: p.assignedTo || null },
      });
  } else if (p.action === "stage") {
    const moving = await Contact.find({ _id: { $in: ids }, stage: { $ne: p.stage } }, { stage: 1 }).lean();
    changed = (
      await Contact.updateMany({ _id: { $in: moving.map((c) => c._id) } }, { stage: p.stage, stageChangedAt: new Date() })
    ).modifiedCount;
    if (changed)
      await audit({
        actorId: me.id,
        action: "contact.bulk_stage",
        entity: "contacts",
        before: { stage: Object.fromEntries(moving.map((c) => [String(c._id), c.stage])) },
        after: { stage: p.stage },
      });
  } else {
    changed = (await Contact.updateMany({ _id: { $in: ids } }, { $addToSet: { tags: p.tag } })).modifiedCount;
  }

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
  const id = objectId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const contact = await Contact.exists({ _id: id.data, ...(user.role === "owner" ? {} : { assignedTo: oid(user.id) }) });
  if (!contact) return { ok: false, error: "Contact not found." };

  const [calls, logs, callbacks] = await Promise.all([
    Call.find({ contactId: id.data }).sort({ calledAt: -1 }).limit(100).lean(),
    WhatsappLog.find({ contactId: id.data }).sort({ sentAt: -1 }).limit(100).lean(),
    Callback.find({ contactId: id.data }).sort({ dueAt: -1 }).limit(50).lean(),
  ]);
  const users = await User.find({ _id: { $in: [...calls.map((c) => c.callerId), ...logs.map((l) => l.callerId)] } }, { name: 1 }).lean();
  const name = (uid: unknown) => users.find((u) => String(u._id) === String(uid))?.name ?? "";
  return {
    ok: true,
    activity: {
      calls: calls.map((c) => ({ id: String(c._id), at: c.calledAt.toISOString(), outcome: c.outcome, notes: c.notes, durationSec: c.durationSec ?? undefined, caller: name(c.callerId) })),
      whatsapp: logs.map((l) => ({ id: String(l._id), at: l.sentAt.toISOString(), template: l.templateName, caller: name(l.callerId) })),
      callbacks: callbacks.map((c) => ({
        id: String(c._id),
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
  const before = await Contact.findOneAndUpdate(
    { _id: p.data.id, stage: { $ne: p.data.stage } },
    { stage: p.data.stage, stageChangedAt: new Date() },
  ).lean();
  if (before)
    await audit({ actorId: me.id, action: "contact.stage", entity: "contacts", entityId: before._id, before: { stage: before.stage }, after: { stage: p.data.stage, via: "pipeline" } });
  revalidatePath("/pipeline");
  return { ok: true };
}
