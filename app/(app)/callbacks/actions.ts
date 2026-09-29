"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { closeCallback, scheduleCallback } from "@/lib/callbacks";
import { Callback } from "@/lib/models/callback";
import { Contact } from "@/lib/models/contact";
import { cancelCallbackSchema, objectId, rescheduleSchema } from "@/lib/schemas";
import { type CurrentUser, requireUser } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

async function findPending(me: CurrentUser, id: string) {
  return Callback.findOne({
    _id: id,
    status: "pending",
    ...(me.role === "owner" ? {} : { callerId: new Types.ObjectId(me.id) }),
  }).lean();
}

export async function rescheduleCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = rescheduleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a valid time." };
  const dueAt = new Date(p.data.dueAt);
  if (dueAt.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "That time is in the past." };
  const cb = await findPending(me, p.data.id);
  if (!cb) return { ok: false, error: "Callback not found, or already closed." };
  const contact = await Contact.findById(cb.contactId, { campaignId: 1, assignedTo: 1 }).lean();
  if (!contact) return { ok: false, error: "Contact not found." };
  await scheduleCallback(contact, me.id, dueAt, p.data.note);
  revalidatePath("/callbacks");
  return { ok: true };
}

export async function completeCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const id = objectId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const cb = await findPending(me, id.data);
  if (!cb) return { ok: false, error: "Callback not found, or already closed." };
  await closeCallback(cb.contactId, me.id, "done");
  revalidatePath("/callbacks");
  return { ok: true };
}

export async function cancelCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = cancelCallbackSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Give a reason for cancelling." };
  const cb = await findPending(me, p.data.id);
  if (!cb) return { ok: false, error: "Callback not found, or already closed." };
  await closeCallback(cb.contactId, me.id, "cancelled", p.data.reason);
  revalidatePath("/callbacks");
  return { ok: true };
}
