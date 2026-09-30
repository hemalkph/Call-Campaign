"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { closeCallback, scheduleCallback } from "@/lib/callbacks";
import { callbacks, contacts, db } from "@/lib/db";
import { cancelCallbackSchema, recordId, rescheduleSchema } from "@/lib/schemas";
import { type CurrentUser, requireUser } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };
const GONE = "Callback not found, or already closed.";

async function findPending(me: CurrentUser, id: string) {
  const [cb] = await db
    .select()
    .from(callbacks)
    .where(and(eq(callbacks.id, id), eq(callbacks.status, "pending"), me.role === "owner" ? undefined : eq(callbacks.callerId, me.id)));
  return cb;
}

export async function rescheduleCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = rescheduleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a valid time." };
  const dueAt = new Date(p.data.dueAt);
  if (dueAt.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "That time is in the past." };
  const cb = await findPending(me, p.data.id);
  if (!cb) return { ok: false, error: GONE };
  await db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: contacts.id, campaignId: contacts.campaignId, assignedTo: contacts.assignedTo })
      .from(contacts)
      .where(eq(contacts.id, cb.contactId));
    await scheduleCallback(contact, me.id, dueAt, p.data.note, tx);
  });
  revalidatePath("/callbacks");
  return { ok: true };
}

export async function completeCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const id = recordId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const cb = await findPending(me, id.data);
  if (!cb) return { ok: false, error: GONE };
  await db.transaction((tx) => closeCallback(cb.contactId, me.id, "done", undefined, tx));
  revalidatePath("/callbacks");
  return { ok: true };
}

export async function cancelCallback(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = cancelCallbackSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Give a reason for cancelling." };
  const cb = await findPending(me, p.data.id);
  if (!cb) return { ok: false, error: GONE };
  await db.transaction((tx) => closeCallback(cb.contactId, me.id, "cancelled", p.data.reason, tx));
  revalidatePath("/callbacks");
  return { ok: true };
}
