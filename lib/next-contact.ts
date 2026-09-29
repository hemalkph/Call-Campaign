// Picks who a caller should phone next, and shapes a contact for the calling screen.
import { Types } from "mongoose";
import { OPEN_STAGES } from "./calling";
import { Call } from "./models/call";
import { Callback } from "./models/callback";
import { Contact, type ContactDoc } from "./models/contact";
import { User } from "./models/user";
import { dayBounds } from "./time";
import type { Outcome, Stage } from "./vocab";

export type NextReason = "overdue_callback" | "callback_today" | "never_called" | "follow_up" | "chosen";

/**
 * Priority: overdue callbacks → today's callbacks → never called → longest since last attempt.
 * Contacts with a callback later than today wait for it. "Today" is the Sri Lankan day.
 */
export async function findNextContact(callerId: string, campaignId: string, skip: string[] = [], now = new Date()) {
  const { end } = dayBounds(now);
  const base = {
    campaignId: new Types.ObjectId(campaignId),
    assignedTo: new Types.ObjectId(callerId),
    _id: { $nin: skip.map((id) => new Types.ObjectId(id)) },
  };
  const steps: [NextReason, object, Record<string, 1>][] = [
    ["overdue_callback", { nextCallbackAt: { $lt: now } }, { nextCallbackAt: 1 }],
    ["callback_today", { nextCallbackAt: { $gte: now, $lt: end } }, { nextCallbackAt: 1 }],
    ["never_called", { nextCallbackAt: null, lastCallAt: null, stage: { $in: OPEN_STAGES } }, { createdAt: 1 }],
    ["follow_up", { nextCallbackAt: null, stage: { $in: OPEN_STAGES } }, { lastCallAt: 1 }],
  ];
  for (const [reason, filter, sort] of steps) {
    const contact = await Contact.findOne({ ...base, ...filter }).sort({ ...sort, _id: 1 }).lean();
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

export async function toCard(contact: ContactDoc & { _id: Types.ObjectId }, reason: NextReason): Promise<ContactCard> {
  const [calls, callback] = await Promise.all([
    Call.find({ contactId: contact._id }).sort({ calledAt: -1 }).limit(3).lean(),
    Callback.findOne({ contactId: contact._id, status: "pending" }, { note: 1 }).lean(),
  ]);
  const callers = await User.find({ _id: { $in: calls.map((c) => c.callerId) } }, { name: 1 }).lean();
  const name = (id: unknown) => callers.find((u) => String(u._id) === String(id))?.name ?? "";
  return {
    id: String(contact._id),
    name: contact.name,
    phone: contact.phone,
    altPhone: contact.altPhone ?? "",
    school: contact.school ?? "",
    district: contact.district ?? "",
    gradeOrBatch: contact.gradeOrBatch ?? "",
    notes: contact.notes,
    stage: contact.stage,
    lastOutcome: contact.lastOutcome ?? null,
    lastCallAt: contact.lastCallAt?.toISOString() ?? null,
    nextCallbackAt: contact.nextCallbackAt?.toISOString() ?? null,
    callbackNote: callback?.note ?? "",
    reason,
    recentCalls: calls.map((c) => ({ outcome: c.outcome, calledAt: c.calledAt.toISOString(), notes: c.notes, caller: name(c.callerId) })),
  };
}
