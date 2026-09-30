import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { contactFilter, listContacts, listParamsSchema, parseListParams } from "@/lib/contacts-query";
import { auditEvents, contacts } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import { signedInAs } from "@/test/auth";
import { resetDb, testDb as db } from "@/test/db";
import { getContact, makeCampaign, makeContact, makeUser, type TestUser } from "@/test/fixtures";
import { bulkUpdateContacts, createContact, setContactStage, updateContact } from "./actions";

let owner: TestUser, nimali: TestUser, kasun: TestUser, outsider: TestUser;
let campaignId: string, otherCampaignId: string;

const asCurrent = (u: TestUser): CurrentUser => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: false });
const fields = { name: "Student", phone: "0711111111", altPhone: "", school: "", district: "", gradeOrBatch: "", source: "", tags: "", notes: "" };
const allContacts = () => db.select().from(contacts).orderBy(asc(contacts.name));
const auditLog = () => db.select().from(auditEvents).orderBy(asc(auditEvents.action));

beforeEach(async () => {
  await resetDb();
  owner = await makeUser("owner", "owner");
  nimali = await makeUser("nimali", "caller");
  kasun = await makeUser("kasun", "caller");
  outsider = await makeUser("outsider", "caller");
  campaignId = (await makeCampaign([nimali, kasun], { name: "October intake", status: "active" })).id;
  otherCampaignId = (await makeCampaign([nimali], { name: "Seminar list", status: "active" })).id;
});

describe("caller visibility", () => {
  it("callers only see their own contacts, whatever filter they send", async () => {
    await makeContact(campaignId, "A", { assignedTo: nimali.id });
    await makeContact(campaignId, "B", { assignedTo: kasun.id });
    await makeContact(campaignId, "C", { assignedTo: null });
    const mine = await listContacts(asCurrent(nimali), campaignId, listParamsSchema.parse({ caller: kasun.id }));
    expect(mine.rows.map((r) => r.name)).toEqual(["A"]);

    const all = await listContacts(asCurrent(owner), campaignId, listParamsSchema.parse({}));
    expect(all.total).toBe(3);
    const unassigned = await listContacts(asCurrent(owner), campaignId, listParamsSchema.parse({ caller: "none" }));
    expect(unassigned.rows.map((r) => r.name)).toEqual(["C"]);
  });

  it("search matches any phone format, ignores case, and treats symbols literally", async () => {
    await makeContact(campaignId, "Saman (A+) 100%", { phone: "0712345678", assignedTo: nimali.id });
    const find = async (q: string) =>
      (await db.select().from(contacts).where(contactFilter(asCurrent(owner), campaignId, { q }))).map((c) => c.name);
    expect(await find("+94 71 234 5678")).toEqual(["Saman (A+) 100%"]);
    expect(await find("2345")).toEqual(["Saman (A+) 100%"]);
    expect(await find("(a+)")).toEqual(["Saman (A+) 100%"]);
    expect(await find("100%")).toEqual(["Saman (A+) 100%"]);
    expect(await find(".*")).toEqual([]);
    expect(await find("_")).toEqual([]);
  });

  it("ignores junk in the URL", () => {
    expect(parseListParams({ stage: "hacked", page: "-4", sort: "$where", caller: ["x", "y"], campaign: "1; drop table" })).toMatchObject({
      stage: undefined,
      page: 1,
      sort: "createdAt",
      caller: undefined,
      campaign: undefined,
    });
  });
});

describe("createContact", () => {
  it("normalizes the phone and assigns a caller's own contact to them", async () => {
    signedInAs(nimali);
    const res = await createContact({ ...fields, phone: "+94 71 111 1111", campaignId, assignedTo: kasun.id });
    expect(res.ok).toBe(true);
    expect((await allContacts())[0]).toMatchObject({ phone: "0711111111", assignedTo: nimali.id, stage: "new", altPhone: null });
  });

  it("rejects callers who aren't on the campaign", async () => {
    signedInAs(outsider);
    expect(await createContact({ ...fields, campaignId })).toEqual({ ok: false, error: "Campaign not found." });
  });

  it("blocks duplicates in the same campaign and warns about other campaigns", async () => {
    signedInAs(owner);
    await createContact({ ...fields, campaignId: otherCampaignId });
    expect(await createContact({ ...fields, phone: "711111111", campaignId: otherCampaignId })).toEqual({
      ok: false,
      error: "This phone number is already in this campaign.",
    });
    const res = await createContact({ ...fields, campaignId });
    expect(res).toMatchObject({ ok: true, warning: "This number is also in: Seminar list." });
  });

  it("owners can only assign callers who are on the campaign", async () => {
    signedInAs(owner);
    expect(await createContact({ ...fields, campaignId, assignedTo: outsider.id })).toMatchObject({ ok: false });
    expect(await createContact({ ...fields, campaignId, assignedTo: kasun.id })).toMatchObject({ ok: true });
  });
});

describe("updateContact", () => {
  let contactId: string;
  beforeEach(async () => {
    contactId = (await makeContact(campaignId, "Student", { phone: fields.phone, assignedTo: nimali.id })).id;
  });

  it("callers can't touch someone else's contact or reassign their own", async () => {
    signedInAs(kasun);
    expect(await updateContact({ ...fields, id: contactId, name: "Hijacked" })).toEqual({ ok: false, error: "Contact not found." });

    signedInAs(nimali);
    expect(await updateContact({ ...fields, id: contactId, assignedTo: kasun.id, tags: "a, b, a" })).toEqual({ ok: true });
    expect(await getContact(contactId)).toMatchObject({ assignedTo: nimali.id, tags: ["a", "b"] });
  });

  it("records stage changes and reassignments in the audit log, without personal data", async () => {
    signedInAs(owner);
    await updateContact({ ...fields, id: contactId, stage: "interested", assignedTo: kasun.id });
    expect(await getContact(contactId)).toMatchObject({ stage: "interested", assignedTo: kasun.id });
    const events = await auditLog();
    expect(events.map((e) => [e.action, e.before, e.after])).toEqual([
      ["contact.reassign", { assignedTo: nimali.id }, { assignedTo: kasun.id }],
      ["contact.stage", { stage: "new" }, { stage: "interested" }],
    ]);
    expect(JSON.stringify(events)).not.toContain(fields.phone);
  });

  it("changing to a phone already in the campaign is refused", async () => {
    await makeContact(campaignId, "Other", { phone: "0719999999" });
    signedInAs(owner);
    expect(await updateContact({ ...fields, id: contactId, phone: "0719999999" })).toEqual({
      ok: false,
      error: "This phone number is already in this campaign.",
    });
  });
});

describe("bulkUpdateContacts", () => {
  it("is owner-only", async () => {
    signedInAs(nimali);
    await expect(bulkUpdateContacts({ action: "addTag", ids: [owner.id], tag: "x" })).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("reassigns, changes stage and tags, auditing only real changes", async () => {
    const a = await makeContact(campaignId, "A", { assignedTo: nimali.id });
    const b = await makeContact(campaignId, "B", { assignedTo: kasun.id, stage: "enrolled" });
    const ids = [a.id, b.id];
    signedInAs(owner);

    expect(await bulkUpdateContacts({ action: "reassign", ids, assignedTo: outsider.id })).toMatchObject({ ok: false });
    expect(await bulkUpdateContacts({ action: "reassign", ids, assignedTo: kasun.id })).toEqual({ ok: true, changed: 1 });
    expect(await bulkUpdateContacts({ action: "stage", ids, stage: "enrolled" })).toEqual({ ok: true, changed: 1 });
    expect(await bulkUpdateContacts({ action: "addTag", ids, tag: "vip" })).toEqual({ ok: true, changed: 2 });
    expect(await bulkUpdateContacts({ action: "addTag", ids, tag: "vip" })).toEqual({ ok: true, changed: 0 }); // no duplicates

    expect((await allContacts()).map((c) => [c.assignedTo, c.stage, c.tags])).toEqual([
      [kasun.id, "enrolled", ["vip"]],
      [kasun.id, "enrolled", ["vip"]],
    ]);
    expect((await auditLog()).map((e) => [e.action, e.before])).toEqual([
      ["contact.bulk_reassign", { assignedTo: { [a.id]: nimali.id } }],
      ["contact.bulk_stage", { stage: { [a.id]: "new" } }],
    ]);
  });
});

describe("setContactStage (pipeline)", () => {
  it("is owner-only, audits real changes with the contact id, and ignores no-ops", async () => {
    const c = await makeContact(campaignId, "P", { assignedTo: nimali.id });
    signedInAs(nimali);
    await expect(setContactStage({ id: c.id, stage: "enrolled" })).rejects.toThrow(/^REDIRECT \/$/);

    signedInAs(owner);
    expect(await setContactStage({ id: c.id, stage: "interested" })).toEqual({ ok: true });
    expect(await setContactStage({ id: c.id, stage: "interested" })).toEqual({ ok: true });
    expect((await getContact(c.id)).stage).toBe("interested");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "contact.stage"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: c.id, before: { stage: "new" }, after: { stage: "interested", via: "pipeline" } });
  });
});
