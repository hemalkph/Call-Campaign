// Callback changes always go through here so contacts.next_callback_at stays in step with
// the (single) pending callback. Pass a transaction to make a change part of a bigger one.
import { and, eq, sql } from "drizzle-orm";
import { type CallbackHistory, callbacks, contacts, db } from "./db";
import type { Tx } from "./db/tx";

type Callback = typeof callbacks.$inferSelect;
export type CallbackUndo = { createdId?: string; before?: Callback };

const addHistory = (entry: Omit<CallbackHistory[number], "at">) =>
  sql`${callbacks.history} || ${JSON.stringify([{ at: new Date().toISOString(), ...entry }])}::jsonb`;

const pendingFor = async (tx: Tx, contactId: string) =>
  (await tx.select().from(callbacks).where(and(eq(callbacks.contactId, contactId), eq(callbacks.status, "pending"))).limit(1))[0];

/** Creates the pending callback, or moves the existing one. Returns what's needed to undo it. */
export async function scheduleCallback(
  contact: { id: string; campaignId: string; assignedTo: string | null },
  by: string,
  dueAt: Date,
  note = "",
  tx: Tx = db,
): Promise<CallbackUndo> {
  const pending = await pendingFor(tx, contact.id);
  let undo: CallbackUndo;
  if (pending) {
    await tx
      .update(callbacks)
      .set({ dueAt, ...(note ? { note } : {}), history: addHistory({ by, action: "rescheduled", dueAt: dueAt.toISOString() }) })
      .where(eq(callbacks.id, pending.id));
    undo = { before: pending };
  } else {
    const [created] = await tx
      .insert(callbacks)
      .values({
        campaignId: contact.campaignId,
        contactId: contact.id,
        callerId: contact.assignedTo,
        dueAt,
        note,
        history: [{ at: new Date().toISOString(), by, action: "created", dueAt: dueAt.toISOString() }],
      })
      .returning({ id: callbacks.id });
    undo = { createdId: created.id };
  }
  await tx.update(contacts).set({ nextCallbackAt: dueAt }).where(eq(contacts.id, contact.id));
  return undo;
}

/** Marks the pending callback done or cancelled (if there is one). */
export async function closeCallback(contactId: string, by: string, status: "done" | "cancelled", reason?: string, tx: Tx = db): Promise<CallbackUndo> {
  const pending = await pendingFor(tx, contactId);
  if (!pending) return {};
  await tx.update(callbacks).set({ status, history: addHistory({ by, action: status, reason }) }).where(eq(callbacks.id, pending.id));
  await tx.update(contacts).set({ nextCallbackAt: null }).where(eq(contacts.id, contactId));
  return { before: pending };
}

/** Reverses scheduleCallback/closeCallback using what they returned (stored as JSON, so dates arrive as strings). */
export async function undoCallbackChange(undo: CallbackUndo | undefined, tx: Tx = db) {
  if (undo?.createdId) await tx.delete(callbacks).where(eq(callbacks.id, undo.createdId));
  const b = undo?.before;
  if (b)
    await tx
      .update(callbacks)
      .set({
        dueAt: new Date(b.dueAt),
        note: b.note,
        status: b.status,
        callerId: b.callerId,
        history: b.history,
        updatedAt: new Date(b.updatedAt),
      })
      .where(eq(callbacks.id, b.id));
}
