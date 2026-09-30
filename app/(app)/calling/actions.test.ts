import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, callbacks, calls, campaigns, templates, whatsappLogs } from "@/lib/db";
import { findNextContact } from "@/lib/next-contact";
import { signedInAs } from "@/test/auth";
import { resetDb, testDb as db } from "@/test/db";
import { getContact, makeCampaign, makeContact, makeUser, type TestUser } from "@/test/fixtures";
import { cancelCallback, completeCallback, rescheduleCallback } from "../callbacks/actions";
import { setWhatsappSent } from "../whatsapp/actions";
import { getNextContact, logCall, undoCall } from "./actions";

let nimali: TestUser, kasun: TestUser;
let campaignId: string;
const H = 3600_000;

beforeEach(async () => {
  await resetDb();
  nimali = await makeUser("nimali", "caller");
  kasun = await makeUser("kasun", "caller");
  campaignId = (await makeCampaign([nimali, kasun], { status: "active" })).id;
  signedInAs(nimali);
});

const contact = (name: string, extra: Parameters<typeof makeContact>[2] = {}) => makeContact(campaignId, name, { assignedTo: nimali.id, ...extra });
const allCallbacks = () => db.select().from(callbacks).orderBy(asc(callbacks.createdAt));
const allCalls = () => db.select().from(calls);

describe("next contact priority", () => {
  // 1 Oct 2026, 14:00 in Colombo
  const now = new Date("2026-10-01T08:30:00Z");

  it("overdue callbacks → today's callbacks → never called → oldest attempt", async () => {
    await contact("followUpNewer", { lastCallAt: new Date(now.getTime() - 1 * H) });
    await contact("followUpOlder", { lastCallAt: new Date(now.getTime() - 30 * H) });
    await contact("tomorrow", { nextCallbackAt: new Date("2026-10-01T18:31:00Z") }); // 00:01 on 2 Oct → waits
    await contact("closed", { stage: "enrolled" });
    await contact("kasuns", { assignedTo: kasun.id });
    await contact("neverCalled");
    await contact("todayLate", { nextCallbackAt: new Date("2026-10-01T18:29:00Z") }); // 23:59 today
    await contact("todayEarly", { nextCallbackAt: new Date(now.getTime() + 1 * H) });
    await contact("overdue", { nextCallbackAt: new Date(now.getTime() - 2 * H) });

    const order: { name: string; id: string }[] = [];
    for (;;) {
      const next = await findNextContact(nimali.id, campaignId, order.map((o) => o.id), now);
      if (!next) break;
      order.push(next.contact);
    }
    expect(order.map((o) => o.name)).toEqual(["overdue", "todayEarly", "todayLate", "neverCalled", "followUpOlder", "followUpNewer"]);
  });

  it("only serves active campaigns the caller is on, and never someone else's contact", async () => {
    const other = await contact("kasuns", { assignedTo: kasun.id });
    expect(await getNextContact({ campaignId, skip: [], contactId: other.id })).toEqual({ ok: true, card: null });
    await db.update(campaigns).set({ status: "ended" }).where(eq(campaigns.id, campaignId));
    expect(await getNextContact({ campaignId, skip: [] })).toMatchObject({ ok: false });
  });
});

describe("logCall", () => {
  it("records the call, moves the stage forward and audits it", async () => {
    const c = await contact("A");
    const res = await logCall({ contactId: c.id, outcome: "interested", notes: "Wants Sunday class", durationSec: 95 });
    expect(res.ok).toBe(true);
    expect(await getContact(c.id)).toMatchObject({ stage: "interested", lastOutcome: "interested" });
    expect((await allCalls())[0]).toMatchObject({ outcome: "interested", durationSec: 95, notes: "Wants Sunday class", callerId: nimali.id });
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "contact.stage"));
    expect(event).toMatchObject({ before: { stage: "new" }, after: { stage: "interested", via: "call" } });
  });

  it("callers can't log calls for other callers' contacts", async () => {
    const c = await contact("B", { assignedTo: kasun.id });
    expect(await logCall({ contactId: c.id, outcome: "answered", notes: "" })).toEqual({ ok: false, error: "Contact not found." });
    expect(await allCalls()).toHaveLength(0);
  });

  it("a callback request schedules one pending callback; calling back completes it", async () => {
    const c = await contact("C");
    const due = new Date(Date.now() + 2 * H).toISOString();
    expect(await logCall({ contactId: c.id, outcome: "callback_requested", notes: "" })).toMatchObject({ ok: false });
    await logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: due, callbackNote: "after 6" });
    const later = new Date(Date.now() + 5 * H).toISOString();
    await logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: later });
    const cbs = await allCallbacks();
    expect(cbs).toHaveLength(1); // rescheduled, not duplicated
    expect(cbs[0]).toMatchObject({ status: "pending", note: "after 6", dueAt: new Date(later) });
    expect((await getContact(c.id)).nextCallbackAt).toEqual(new Date(later));

    await logCall({ contactId: c.id, outcome: "will_enroll", notes: "" });
    expect((await allCallbacks())[0]).toMatchObject({ status: "done" });
    expect((await getContact(c.id)).nextCallbackAt).toBeNull();
  });

  it("rejects callback times in the past", async () => {
    const c = await contact("E");
    const past = new Date(Date.now() - H).toISOString();
    expect(await logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: past })).toMatchObject({ ok: false });
  });

  it("saves everything or nothing: a failure part-way leaves no trace", async () => {
    const c = await contact("F");
    // Make the database reject the call row, which is written after the callback is scheduled.
    await db.execute(sql`create function fail_call() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await db.execute(sql`create trigger fail_call before insert on calls for each row execute function fail_call()`);
    try {
      const due = new Date(Date.now() + H).toISOString();
      await expect(logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: due })).rejects.toThrow();
      expect(await allCallbacks()).toHaveLength(0); // the callback was rolled back with the failed call
      expect(await allCalls()).toHaveLength(0);
      expect(await getContact(c.id)).toMatchObject({ nextCallbackAt: null, lastCallAt: null });
    } finally {
      await db.execute(sql`drop trigger fail_call on calls`);
      await db.execute(sql`drop function fail_call()`);
    }
  });
});

describe("undoCall", () => {
  it("restores the contact and callback exactly, within the time limit only", async () => {
    const c = await contact("F", { stage: "contacted", lastOutcome: "no_answer", lastCallAt: new Date("2026-09-01") });
    const due = new Date(Date.now() + 3 * H);
    await logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: due.toISOString() });
    const before = await getContact(c.id);

    const res = await logCall({ contactId: c.id, outcome: "not_interested", notes: "" });
    expect((await getContact(c.id)).stage).toBe("not_interested");
    expect(await undoCall(res.ok ? res.callId : "")).toMatchObject({ ok: true });

    expect(await getContact(c.id)).toMatchObject({ stage: before.stage, lastOutcome: "callback_requested", nextCallbackAt: due });
    expect((await allCallbacks())[0]).toMatchObject({ status: "pending", dueAt: due });
    expect(await allCalls()).toHaveLength(1);

    // A newly created callback is removed by undo.
    const g = await contact("G");
    const r2 = await logCall({ contactId: g.id, outcome: "callback_requested", notes: "", callbackAt: due.toISOString() });
    await undoCall(r2.ok ? r2.callId : "");
    expect((await db.select().from(callbacks).where(eq(callbacks.contactId, g.id))).length).toBe(0);
    expect((await getContact(g.id)).nextCallbackAt).toBeNull();
  });

  it("can't undo someone else's call or an old one", async () => {
    const c = await contact("H");
    const res = await logCall({ contactId: c.id, outcome: "answered", notes: "" });
    const id = res.ok ? res.callId : "";
    signedInAs(kasun);
    expect(await undoCall(id)).toMatchObject({ ok: false });
    signedInAs(nimali);
    await db.update(calls).set({ calledAt: new Date(Date.now() - 60_000) }).where(eq(calls.id, id));
    expect(await undoCall(id)).toEqual({ ok: false, error: "Too late to undo this call." });
  });
});

describe("callbacks page actions", () => {
  it("reschedule, complete and cancel keep the contact in step; others' callbacks are off limits", async () => {
    const c = await contact("I");
    await logCall({ contactId: c.id, outcome: "callback_requested", notes: "", callbackAt: new Date(Date.now() + H).toISOString() });
    const [cb] = await allCallbacks();

    signedInAs(kasun);
    expect(await completeCallback(cb.id)).toMatchObject({ ok: false });

    signedInAs(nimali);
    const later = new Date(Date.now() + 26 * H);
    expect(await rescheduleCallback({ id: cb.id, dueAt: later.toISOString() })).toEqual({ ok: true });
    expect((await getContact(c.id)).nextCallbackAt).toEqual(later);

    expect(await cancelCallback({ id: cb.id, reason: "" })).toMatchObject({ ok: false });
    expect(await cancelCallback({ id: cb.id, reason: "Joined another class" })).toEqual({ ok: true });
    const [closed] = await db.select().from(callbacks).where(eq(callbacks.id, cb.id));
    expect(closed.status).toBe("cancelled");
    expect(closed.history.map((h) => h.action)).toEqual(["created", "rescheduled", "cancelled"]);
    expect((await getContact(c.id)).nextCallbackAt).toBeNull();
  });
});

describe("WhatsApp log", () => {
  it("marks and unmarks as sent, keeping the template name", async () => {
    const c = await contact("J");
    const [t] = await db.insert(templates).values({ name: "Intro (EN)", language: "en", body: "Hi {name}" }).returning();
    expect(await setWhatsappSent({ contactId: c.id, templateId: t.id, sent: true })).toMatchObject({ ok: true });
    expect((await db.select().from(whatsappLogs))[0]).toMatchObject({ templateName: "Intro (EN)", callerId: nimali.id });
    expect((await getContact(c.id)).lastWhatsappAt).toBeInstanceOf(Date);

    await setWhatsappSent({ contactId: c.id, sent: false });
    expect(await db.select().from(whatsappLogs)).toHaveLength(0);
    expect((await getContact(c.id)).lastWhatsappAt).toBeNull();

    signedInAs(kasun);
    expect(await setWhatsappSent({ contactId: c.id, sent: true })).toMatchObject({ ok: false });
  });
});
