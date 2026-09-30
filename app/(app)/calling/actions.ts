"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { closeCallback, type CallbackUndo, scheduleCallback, undoCallbackChange } from "@/lib/callbacks";
import { stageAfter } from "@/lib/calling";
import { calls, campaignCallers, campaigns, contacts, db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/tx";
import { type ContactCard, findNextContact, toCard } from "@/lib/next-contact";
import { logCallSchema, recordId } from "@/lib/schemas";
import { type CurrentUser, requireUser } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type ContactUndo = {
  stage: string;
  stageChangedAt: string;
  lastCallAt: string | null;
  lastOutcome: string | null;
  nextCallbackAt: string | null;
};

const UNDO_WINDOW_MS = 30_000; // the screen offers 10 s; the rest is slack for slow connections

/** Contacts a user may log calls for: their own; owners may log for anyone. */
const contactScope = (me: CurrentUser, id: string) =>
  me.role === "owner" ? eq(contacts.id, id) : and(eq(contacts.id, id), eq(contacts.assignedTo, me.id));

const nextSchema = z.strictObject({
  campaignId: recordId,
  skip: z.array(recordId).max(500),
  contactId: recordId.optional(),
});

export async function getNextContact(input: unknown): Promise<Result<{ card: ContactCard | null }>> {
  const me = await requireUser();
  const p = nextSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { campaignId, skip, contactId } = p.data;
  const [member] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(campaignCallers, and(eq(campaignCallers.campaignId, campaigns.id), eq(campaignCallers.userId, me.id)))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "active")));
  if (!member) return { ok: false, error: "You're not on this campaign, or it isn't active." };

  if (contactId) {
    const [contact] = await db.select().from(contacts).where(and(contactScope(me, contactId), eq(contacts.campaignId, campaignId)));
    if (contact) return { ok: true, card: await toCard(contact, "chosen") };
  }
  const next = await findNextContact(me.id, campaignId, skip);
  return { ok: true, card: next ? await toCard(next.contact, next.reason) : null };
}

/** Logs a call. Everything it changes (call, contact, callback, audit) is saved together or not at all. */
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

  try {
    const callId = await db.transaction(async (tx) => {
      const [contact] = await tx.select().from(contacts).where(contactScope(me, contactId)).for("update");
      if (!contact) return null;

      const callback: CallbackUndo = dueAt
        ? await scheduleCallback(contact, me.id, dueAt, callbackNote, tx)
        : await closeCallback(contact.id, me.id, "done", undefined, tx); // calling back completes a pending callback

      const before: ContactUndo = {
        stage: contact.stage,
        stageChangedAt: contact.stageChangedAt.toISOString(),
        lastCallAt: contact.lastCallAt?.toISOString() ?? null,
        lastOutcome: contact.lastOutcome,
        nextCallbackAt: contact.nextCallbackAt?.toISOString() ?? null,
      };
      const stage = stageAfter(contact.stage, outcome);
      const [call] = await tx
        .insert(calls)
        .values({
          campaignId: contact.campaignId,
          contactId: contact.id,
          callerId: me.id,
          calledAt: now,
          outcome,
          durationSec,
          notes,
          undo: { contact: before, callback },
        })
        .returning({ id: calls.id });
      await tx
        .update(contacts)
        .set({ lastCallAt: now, lastOutcome: outcome, ...(stage !== contact.stage ? { stage, stageChangedAt: now } : {}) })
        .where(eq(contacts.id, contact.id));
      if (stage !== contact.stage)
        await audit(
          {
            actorId: me.id,
            action: "contact.stage",
            entity: "contacts",
            entityId: contact.id,
            before: { stage: contact.stage },
            after: { stage, via: "call", callId: call.id },
          },
          tx,
        );
      return call.id;
    });
    if (!callId) return { ok: false, error: "Contact not found." };
    revalidatePath("/today");
    return { ok: true, callId };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "This contact was just updated. Try again." };
    throw e;
  }
}

export async function undoCall(input: unknown): Promise<Result<{ contactId: string }>> {
  const me = await requireUser();
  const id = recordId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };

  const result = await db.transaction(async (tx): Promise<Result<{ contactId: string }>> => {
    const [call] = await tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, id.data), eq(calls.callerId, me.id)))
      .for("update");
    if (!call) return { ok: false, error: "That call was already undone." };
    if (Date.now() - call.calledAt.getTime() > UNDO_WINDOW_MS) return { ok: false, error: "Too late to undo this call." };

    const undo = call.undo as { contact: ContactUndo; callback?: CallbackUndo };
    const [current] = await tx.select({ stage: contacts.stage }).from(contacts).where(eq(contacts.id, call.contactId));
    const date = (s: string | null) => (s ? new Date(s) : null);
    await tx
      .update(contacts)
      .set({
        stage: undo.contact.stage as typeof contacts.$inferInsert.stage,
        stageChangedAt: new Date(undo.contact.stageChangedAt),
        lastCallAt: date(undo.contact.lastCallAt),
        lastOutcome: undo.contact.lastOutcome as typeof contacts.$inferInsert.lastOutcome,
        nextCallbackAt: date(undo.contact.nextCallbackAt),
      })
      .where(eq(contacts.id, call.contactId));
    await undoCallbackChange(undo.callback, tx);
    await tx.delete(calls).where(eq(calls.id, call.id));
    await audit({ actorId: me.id, action: "call.undo", entity: "calls", entityId: call.id, after: { outcome: call.outcome } }, tx);
    if (current && current.stage !== undo.contact.stage)
      await audit(
        {
          actorId: me.id,
          action: "contact.stage",
          entity: "contacts",
          entityId: call.contactId,
          before: { stage: current.stage },
          after: { stage: undo.contact.stage, via: "undo" },
        },
        tx,
      );
    return { ok: true, contactId: call.contactId };
  });

  if (result.ok) revalidatePath("/today");
  return result;
}
