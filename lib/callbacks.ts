// Callback changes always go through here so contact.nextCallbackAt stays in step with
// the (single) pending callback.
import type { Types } from "mongoose";
import { Callback } from "./models/callback";
import { Contact } from "./models/contact";

type Id = string | Types.ObjectId;
export type CallbackUndo = { createdId?: string; before?: Record<string, unknown> };

/** Creates the pending callback, or moves the existing one. Returns what's needed to undo it. */
export async function scheduleCallback(
  contact: { _id: Id; campaignId: Id; assignedTo?: Id | null },
  by: Id,
  dueAt: Date,
  note = "",
): Promise<CallbackUndo> {
  const pending = await Callback.findOne({ contactId: contact._id, status: "pending" }).lean();
  let undo: CallbackUndo;
  if (pending) {
    await Callback.updateOne(
      { _id: pending._id },
      { dueAt, ...(note ? { note } : {}), $push: { history: { by, action: "rescheduled", dueAt } } },
    );
    undo = { before: pending };
  } else {
    const created = await Callback.create({
      campaignId: contact.campaignId,
      contactId: contact._id,
      callerId: contact.assignedTo ?? null,
      dueAt,
      note,
      history: [{ by, action: "created", dueAt }],
    });
    undo = { createdId: String(created._id) };
  }
  await Contact.updateOne({ _id: contact._id }, { nextCallbackAt: dueAt });
  return undo;
}

/** Marks the pending callback done or cancelled (if there is one). */
export async function closeCallback(contactId: Id, by: Id, status: "done" | "cancelled", reason?: string): Promise<CallbackUndo> {
  const pending = await Callback.findOne({ contactId, status: "pending" }).lean();
  if (!pending) return {};
  await Callback.updateOne({ _id: pending._id }, { status, $push: { history: { by, action: status, reason } } });
  await Contact.updateOne({ _id: contactId }, { nextCallbackAt: null });
  return { before: pending };
}

export async function undoCallbackChange(undo: CallbackUndo | undefined) {
  if (undo?.createdId) await Callback.deleteOne({ _id: undo.createdId });
  if (undo?.before) await Callback.replaceOne({ _id: undo.before._id }, undo.before);
}
