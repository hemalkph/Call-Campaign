"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { closeCallback, type CallbackUndo, scheduleCallback, undoCallbackChange } from "@/lib/callbacks";
import { stageAfter } from "@/lib/calling";
import { audit } from "@/lib/models/audit-event";
import { Call } from "@/lib/models/call";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { type ContactCard, findNextContact, toCard } from "@/lib/next-contact";
import { logCallSchema, objectId } from "@/lib/schemas";
import { type CurrentUser, requireUser } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UNDO_WINDOW_MS = 30_000; // the screen offers 10 s; the rest is slack for slow connections

/** Contacts a user may log calls for: their own; owners may log for anyone. */
const contactScope = (me: CurrentUser, id: string) =>
  me.role === "owner" ? { _id: id } : { _id: id, assignedTo: new Types.ObjectId(me.id) };

const nextSchema = z.strictObject({
  campaignId: objectId,
  skip: z.array(objectId).max(500),
  contactId: objectId.optional(),
});

export async function getNextContact(input: unknown): Promise<Result<{ card: ContactCard | null }>> {
  const me = await requireUser();
  const p = nextSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { campaignId, skip, contactId } = p.data;
  if (!(await Campaign.exists({ _id: campaignId, status: "active", "callers.userId": new Types.ObjectId(me.id) })))
    return { ok: false, error: "You're not on this campaign, or it isn't active." };

  if (contactId) {
    const contact = await Contact.findOne({ ...contactScope(me, contactId), campaignId }).lean();
    if (contact) return { ok: true, card: await toCard(contact, "chosen") };
  }
  const next = await findNextContact(me.id, campaignId, skip);
  return { ok: true, card: next ? await toCard(next.contact, next.reason) : null };
}

export async function logCall(input: unknown): Promise<Result<{ callId: string }>> {
  const me = await requireUser();
  const p = logCallSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the call details." };
  const { contactId, outcome, notes, durationSec, callbackAt, callbackNote } = p.data;
  const now = new Date();

  let dueAt: Date | undefined;
  if (outcome === "callback_requested") {
    if (!callbackAt) return { ok: false, error: "Pick a time for the callback." };
    dueAt = new Date(callbackAt);
    if (dueAt.getTime() < now.getTime() - 5 * 60_000) return { ok: false, error: "The callback time is in the past." };
    if (dueAt.getTime() > now.getTime() + 366 * 86_400_000) return { ok: false, error: "The callback is more than a year away." };
  }

  const contact = await Contact.findOne(contactScope(me, contactId)).lean();
  if (!contact) return { ok: false, error: "Contact not found." };

  let callback: CallbackUndo = {};
  try {
    callback = dueAt
      ? await scheduleCallback(contact, me.id, dueAt, callbackNote)
      : await closeCallback(contact._id, me.id, "done"); // calling back completes a pending callback
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "This contact was just updated. Try again." };
    throw e;
  }

  const before = {
    stage: contact.stage,
    stageChangedAt: contact.stageChangedAt,
    lastCallAt: contact.lastCallAt,
    lastOutcome: contact.lastOutcome,
    nextCallbackAt: contact.nextCallbackAt,
  };
  const stage = stageAfter(contact.stage, outcome);
  const call = await Call.create({
    campaignId: contact.campaignId,
    contactId: contact._id,
    callerId: me.id,
    calledAt: now,
    outcome,
    durationSec,
    notes,
    undo: { contact: before, callback },
  });
  await Contact.updateOne(
    { _id: contact._id },
    { lastCallAt: now, lastOutcome: outcome, ...(stage !== contact.stage ? { stage, stageChangedAt: now } : {}) },
  );
  if (stage !== contact.stage)
    await audit({
      actorId: me.id,
      action: "contact.stage",
      entity: "contacts",
      entityId: contact._id,
      before: { stage: contact.stage },
      after: { stage, via: "call", callId: String(call._id) },
    });

  revalidatePath("/today");
  return { ok: true, callId: String(call._id) };
}

export async function undoCall(input: unknown): Promise<Result<{ contactId: string }>> {
  const me = await requireUser();
  const id = objectId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const call = await Call.findOne({ _id: id.data, callerId: me.id }).select("+undo");
  if (!call) return { ok: false, error: "That call was already undone." };
  if (Date.now() - call.calledAt.getTime() > UNDO_WINDOW_MS) return { ok: false, error: "Too late to undo this call." };

  const undo = call.undo as { contact: Record<string, unknown>; callback?: CallbackUndo };
  const current = await Contact.findById(call.contactId, { stage: 1 }).lean();
  await Contact.updateOne({ _id: call.contactId }, { $set: undo.contact });
  await undoCallbackChange(undo.callback);
  await Call.deleteOne({ _id: call._id });
  await audit({ actorId: me.id, action: "call.undo", entity: "calls", entityId: call._id, after: { outcome: call.outcome } });
  if (current && current.stage !== undo.contact.stage)
    await audit({
      actorId: me.id,
      action: "contact.stage",
      entity: "contacts",
      entityId: call.contactId,
      before: { stage: current.stage },
      after: { stage: undo.contact.stage, via: "undo" },
    });

  revalidatePath("/today");
  return { ok: true, contactId: String(call.contactId) };
}
