import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/mongo";
import { AuditEvent } from "@/lib/models/audit-event";
import { Call } from "@/lib/models/call";
import { Callback } from "@/lib/models/callback";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { Template } from "@/lib/models/template";
import { User } from "@/lib/models/user";
import { WhatsappLog } from "@/lib/models/whatsapp-log";
import { findNextContact } from "@/lib/next-contact";
import { signedInAs } from "@/test/auth";
import { cancelCallback, completeCallback, rescheduleCallback } from "../callbacks/actions";
import { setWhatsappSent } from "../whatsapp/actions";
import { getNextContact, logCall, undoCall } from "./actions";

type U = InstanceType<typeof User>;
let nimali: U, kasun: U;
let campaignId: string;
const H = 3600_000;

beforeEach(async () => {
  await Promise.all(
    [User, Campaign, Contact, Call, Callback, AuditEvent, WhatsappLog, Template].map((m) => (m as typeof User).deleteMany({})),
  );
  const mk = (name: string, role: "owner" | "caller") => User.create({ name, email: `${name}@example.test`, passwordHash: "x", role, mustChangePassword: false });
  [nimali, kasun] = await Promise.all([mk("nimali", "caller"), mk("kasun", "caller")]);
  const c = await Campaign.create({
    name: "Oct",
    classLabel: "A/L",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    status: "active",
    callers: [{ userId: nimali._id }, { userId: kasun._id }],
  });
  campaignId = String(c._id);
  signedInAs(nimali);
});
afterEach(() => vi.useRealTimers());

const contact = (name: string, extra: object = {}) =>
  Contact.create({ campaignId, name, phone: `07${String(Math.random()).slice(2, 10)}`, assignedTo: nimali._id, ...extra });

describe("next contact priority", () => {
  // 1 Oct 2026, 14:00 in Colombo
  const now = new Date("2026-10-01T08:30:00Z");

  it("overdue callbacks → today's callbacks → never called → oldest attempt", async () => {
    await contact("followUpNewer", { lastCallAt: new Date(now.getTime() - 1 * H) });
    await contact("followUpOlder", { lastCallAt: new Date(now.getTime() - 30 * H) });
    await contact("tomorrow", { nextCallbackAt: new Date("2026-10-01T18:31:00Z") }); // 00:01 on 2 Oct → waits
    await contact("closed", { stage: "enrolled" });
    await contact("kasuns", { assignedTo: kasun._id });
    await contact("neverCalled");
    await contact("todayLate", { nextCallbackAt: new Date("2026-10-01T18:29:00Z") }); // 23:59 today
    await contact("todayEarly", { nextCallbackAt: new Date(now.getTime() + 1 * H) });
    await contact("overdue", { nextCallbackAt: new Date(now.getTime() - 2 * H) });

    const order: string[] = [];
    for (;;) {
      const next = await findNextContact(String(nimali._id), campaignId, order.map((n) => n.split(":")[1]), now);
      if (!next) break;
      order.push(`${next.contact.name}:${next.contact._id}`);
    }
    expect(order.map((o) => o.split(":")[0])).toEqual(["overdue", "todayEarly", "todayLate", "neverCalled", "followUpOlder", "followUpNewer"]);
  });

  it("only serves active campaigns the caller is on, and never someone else's contact", async () => {
    const other = await contact("kasuns", { assignedTo: kasun._id });
    expect(await getNextContact({ campaignId, skip: [], contactId: String(other._id) })).toEqual({ ok: true, card: null });
    await Campaign.updateOne({ _id: campaignId }, { status: "ended" });
    expect(await getNextContact({ campaignId, skip: [] })).toMatchObject({ ok: false });
  });
});

describe("logCall", () => {
  it("records the call, moves the stage forward and audits it", async () => {
    const c = await contact("A");
    const res = await logCall({ contactId: String(c._id), outcome: "interested", notes: "Wants Sunday class", durationSec: 95 });
    expect(res.ok).toBe(true);
    expect(await Contact.findById(c._id).lean()).toMatchObject({ stage: "interested", lastOutcome: "interested" });
    expect(await Call.findOne().lean()).toMatchObject({ outcome: "interested", durationSec: 95, notes: "Wants Sunday class", callerId: nimali._id });
    expect(await AuditEvent.findOne({ action: "contact.stage" }).lean()).toMatchObject({ before: { stage: "new" }, after: { stage: "interested", via: "call" } });
  });

  it("callers can't log calls for other callers' contacts", async () => {
    const c = await contact("B", { assignedTo: kasun._id });
    expect(await logCall({ contactId: String(c._id), outcome: "answered", notes: "" })).toEqual({ ok: false, error: "Contact not found." });
    expect(await Call.countDocuments()).toBe(0);
  });

  it("a callback request schedules one pending callback; calling back completes it", async () => {
    const c = await contact("C");
    const due = new Date(Date.now() + 2 * H).toISOString();
    expect(await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "" })).toMatchObject({ ok: false });
    await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "", callbackAt: due, callbackNote: "after 6" });
    const later = new Date(Date.now() + 5 * H).toISOString();
    await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "", callbackAt: later });
    const callbacks = await Callback.find().lean();
    expect(callbacks).toHaveLength(1); // rescheduled, not duplicated
    expect(callbacks[0]).toMatchObject({ status: "pending", note: "after 6", dueAt: new Date(later) });
    expect((await Contact.findById(c._id).lean())?.nextCallbackAt).toEqual(new Date(later));

    await logCall({ contactId: String(c._id), outcome: "will_enroll", notes: "" });
    expect(await Callback.findOne().lean()).toMatchObject({ status: "done" });
    expect((await Contact.findById(c._id).lean())?.nextCallbackAt).toBeNull();
  });

  it("the database allows only one pending callback per contact", async () => {
    const c = await contact("D");
    const base = { campaignId, contactId: c._id, dueAt: new Date() };
    await Callback.create(base);
    await expect(Callback.create(base)).rejects.toThrow(/duplicate key/);
    await Callback.create({ ...base, status: "done" });
  });

  it("rejects callback times in the past", async () => {
    const c = await contact("E");
    const past = new Date(Date.now() - H).toISOString();
    expect(await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "", callbackAt: past })).toMatchObject({ ok: false });
  });
});

describe("undoCall", () => {
  it("restores the contact and callback exactly, within the time limit only", async () => {
    const c = await contact("F", { stage: "contacted", lastOutcome: "no_answer", lastCallAt: new Date("2026-09-01") });
    const due = new Date(Date.now() + 3 * H);
    await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "", callbackAt: due.toISOString() });
    const before = await Contact.findById(c._id).lean();

    const res = await logCall({ contactId: String(c._id), outcome: "not_interested", notes: "" });
    expect((await Contact.findById(c._id).lean())?.stage).toBe("not_interested");
    expect(await undoCall(res.ok ? res.callId : "")).toMatchObject({ ok: true });

    const after = await Contact.findById(c._id).lean();
    expect(after).toMatchObject({ stage: before!.stage, lastOutcome: "callback_requested", nextCallbackAt: due });
    expect(await Callback.findOne().lean()).toMatchObject({ status: "pending", dueAt: due });
    expect(await Call.countDocuments()).toBe(1);

    // A newly created callback is removed by undo.
    const g = await contact("G");
    const r2 = await logCall({ contactId: String(g._id), outcome: "callback_requested", notes: "", callbackAt: due.toISOString() });
    await undoCall(r2.ok ? r2.callId : "");
    expect(await Callback.countDocuments({ contactId: g._id })).toBe(0);
    expect((await Contact.findById(g._id).lean())?.nextCallbackAt).toBeNull();
  });

  it("can't undo someone else's call or an old one", async () => {
    const c = await contact("H");
    const res = await logCall({ contactId: String(c._id), outcome: "answered", notes: "" });
    const id = res.ok ? res.callId : "";
    signedInAs(kasun);
    expect(await undoCall(id)).toMatchObject({ ok: false });
    signedInAs(nimali);
    await Call.updateOne({ _id: id }, { calledAt: new Date(Date.now() - 60_000) });
    expect(await undoCall(id)).toEqual({ ok: false, error: "Too late to undo this call." });
  });
});

describe("callbacks page actions", () => {
  it("reschedule, complete and cancel keep the contact in step; others' callbacks are off limits", async () => {
    const c = await contact("I");
    await logCall({ contactId: String(c._id), outcome: "callback_requested", notes: "", callbackAt: new Date(Date.now() + H).toISOString() });
    const cb = await Callback.findOne().lean();
    const id = String(cb!._id);

    signedInAs(kasun);
    expect(await completeCallback(id)).toMatchObject({ ok: false });

    signedInAs(nimali);
    const later = new Date(Date.now() + 26 * H);
    expect(await rescheduleCallback({ id, dueAt: later.toISOString() })).toEqual({ ok: true });
    expect((await Contact.findById(c._id).lean())?.nextCallbackAt).toEqual(later);

    expect(await cancelCallback({ id, reason: "" })).toMatchObject({ ok: false });
    expect(await cancelCallback({ id, reason: "Joined another class" })).toEqual({ ok: true });
    const closed = await Callback.findById(id).lean();
    expect(closed?.status).toBe("cancelled");
    expect(closed?.history.map((h) => h.action)).toEqual(["created", "rescheduled", "cancelled"]);
    expect((await Contact.findById(c._id).lean())?.nextCallbackAt).toBeNull();
  });
});

describe("WhatsApp log", () => {
  it("marks and unmarks as sent, keeping the template name", async () => {
    const c = await contact("J");
    const t = await Template.create({ name: "Intro (EN)", language: "en", body: "Hi {name}" });
    expect(await setWhatsappSent({ contactId: String(c._id), templateId: String(t._id), sent: true })).toMatchObject({ ok: true });
    expect(await WhatsappLog.findOne().lean()).toMatchObject({ templateName: "Intro (EN)", callerId: nimali._id });
    expect((await Contact.findById(c._id).lean())?.lastWhatsappAt).toBeInstanceOf(Date);

    await setWhatsappSent({ contactId: String(c._id), sent: false });
    expect(await WhatsappLog.countDocuments()).toBe(0);
    expect((await Contact.findById(c._id).lean())?.lastWhatsappAt).toBeNull();

    signedInAs(kasun);
    expect(await setWhatsappSent({ contactId: String(c._id), sent: true })).toMatchObject({ ok: false });
  });
});
