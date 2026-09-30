// Picks who a caller should phone next, and shapes a contact for the calling screen.
import { and, asc, desc, eq, gte, inArray, isNull, lt, notInArray, type SQL } from "drizzle-orm";
import { OPEN_STAGES } from "./calling";
import { callbacks, calls, contacts, db, users } from "./db";
import { dayBounds } from "./time";
import type { Outcome, Stage } from "./vocab";

export type NextReason = "overdue_callback" | "callback_today" | "never_called" | "follow_up" | "chosen";
type Contact = typeof contacts.$inferSelect;

/**
 * Priority: overdue callbacks → today's callbacks → never called → longest since last attempt.
 * Contacts with a callback later than today wait for it. "Today" is the Sri Lankan day.
 */
export async function findNextContact(callerId: string, campaignId: string, skip: string[] = [], now = new Date()) {
  const { end } = dayBounds(now);
  const base = and(eq(contacts.campaignId, campaignId), eq(contacts.assignedTo, callerId), skip.length ? notInArray(contacts.id, skip) : undefined);
  const open = inArray(contacts.stage, OPEN_STAGES);
  const steps: [NextReason, SQL | undefined, SQL][] = [
    ["overdue_callback", lt(contacts.nextCallbackAt, now), asc(contacts.nextCallbackAt)],
    ["callback_today", and(gte(contacts.nextCallbackAt, now), lt(contacts.nextCallbackAt, end)), asc(contacts.nextCallbackAt)],
    ["never_called", and(isNull(contacts.nextCallbackAt), isNull(contacts.lastCallAt), open), asc(contacts.createdAt)],
    ["follow_up", and(isNull(contacts.nextCallbackAt), open), asc(contacts.lastCallAt)],
  ];
  for (const [reason, filter, order] of steps) {
    const [contact] = await db.select().from(contacts).where(and(base, filter)).orderBy(order, asc(contacts.id)).limit(1);
    if (contact) return { contact, reason };
  }
  return null;
}

export type ContactCard = {
  id: string;
  name: string;
  phone: string;
  altPhone: string;
  school: string;
  district: string;
  gradeOrBatch: string;
  notes: string;
  stage: Stage;
  lastOutcome: Outcome | null;
  lastCallAt: string | null;
  nextCallbackAt: string | null;
  callbackNote: string;
  reason: NextReason;
  recentCalls: { outcome: Outcome; calledAt: string; notes: string; caller: string }[];
};

export async function toCard(contact: Contact, reason: NextReason): Promise<ContactCard> {
  const [recent, [callback]] = await Promise.all([
    db
      .select({ outcome: calls.outcome, calledAt: calls.calledAt, notes: calls.notes, caller: users.name })
      .from(calls)
      .leftJoin(users, eq(users.id, calls.callerId))
      .where(eq(calls.contactId, contact.id))
      .orderBy(desc(calls.calledAt))
      .limit(3),
    db
      .select({ note: callbacks.note })
      .from(callbacks)
      .where(and(eq(callbacks.contactId, contact.id), eq(callbacks.status, "pending")))
      .limit(1),
  ]);
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    altPhone: contact.altPhone ?? "",
    school: contact.school,
    district: contact.district,
    gradeOrBatch: contact.gradeOrBatch,
    notes: contact.notes,
    stage: contact.stage,
    lastOutcome: contact.lastOutcome,
    lastCallAt: contact.lastCallAt?.toISOString() ?? null,
    nextCallbackAt: contact.nextCallbackAt?.toISOString() ?? null,
    callbackNote: callback?.note ?? "",
    reason,
    recentCalls: recent.map((c) => ({ outcome: c.outcome, calledAt: c.calledAt.toISOString(), notes: c.notes, caller: c.caller ?? "" })),
  };
}
