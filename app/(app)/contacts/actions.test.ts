import { beforeEach, describe, expect, it } from "vitest";
import "@/test/mongo";
import { contactFilter, listContacts, listParamsSchema, parseListParams } from "@/lib/contacts-query";
import { AuditEvent } from "@/lib/models/audit-event";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { User } from "@/lib/models/user";
import type { CurrentUser } from "@/lib/session";
import { signedInAs } from "@/test/auth";
import { bulkUpdateContacts, createContact, setContactStage, updateContact } from "./actions";

type U = InstanceType<typeof User>;
let owner: U, nimali: U, kasun: U, outsider: U;
let campaignId: string, otherCampaignId: string;

const asCurrent = (u: U): CurrentUser => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, mustChangePassword: false });
const fields = { name: "Student", phone: "0711111111", altPhone: "", school: "", district: "", gradeOrBatch: "", source: "", tags: "", notes: "" };

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Campaign.deleteMany({}), Contact.deleteMany({}), AuditEvent.deleteMany({})]);
  const mk = (name: string, role: "owner" | "caller") =>
    User.create({ name, email: `${name}@example.test`, passwordHash: "x", role, mustChangePassword: false });
  [owner, nimali, kasun, outsider] = await Promise.all([mk("owner", "owner"), mk("nimali", "caller"), mk("kasun", "caller"), mk("outsider", "caller")]);
  const base = { classLabel: "2027 A/L", startDate: "2026-10-01", endDate: "2026-12-31", status: "active" as const };
  const [c1, c2] = await Campaign.create([
    { ...base, name: "October intake", callers: [{ userId: nimali._id }, { userId: kasun._id }] },
    { ...base, name: "Seminar list", callers: [{ userId: nimali._id }] },
  ]);
  campaignId = String(c1._id);
  otherCampaignId = String(c2._id);
});

describe("caller visibility", () => {
  it("callers only see their own contacts, whatever filter they send", async () => {
    await Contact.create([
      { campaignId, name: "A", phone: "0710000001", assignedTo: nimali._id },
      { campaignId, name: "B", phone: "0710000002", assignedTo: kasun._id },
      { campaignId, name: "C", phone: "0710000003", assignedTo: null },
    ]);
    const params = listParamsSchema.parse({ caller: String(kasun._id) });
    const mine = await listContacts(asCurrent(nimali), campaignId, params);
    expect(mine.rows.map((r) => r.name)).toEqual(["A"]);

    const all = await listContacts(asCurrent(owner), campaignId, listParamsSchema.parse({}));
    expect(all.total).toBe(3);
    const unassigned = await listContacts(asCurrent(owner), campaignId, listParamsSchema.parse({ caller: "none" }));
    expect(unassigned.rows.map((r) => r.name)).toEqual(["C"]);
  });

  it("search matches any phone format and escapes regex characters", async () => {
    await Contact.create({ campaignId, name: "Saman (A+)", phone: "0712345678", assignedTo: nimali._id });
    const find = async (q: string) =>
      (await Contact.find(contactFilter(asCurrent(owner), campaignId, { q })).lean()).map((c) => c.name);
    expect(await find("+94 71 234 5678")).toEqual(["Saman (A+)"]);
    expect(await find("2345")).toEqual(["Saman (A+)"]);
    expect(await find("(A+)")).toEqual(["Saman (A+)"]);
    expect(await find(".*")).toEqual([]);
  });

  it("ignores junk in the URL", () => {
    expect(parseListParams({ stage: "hacked", page: "-4", sort: "$where", caller: ["x", "y"] })).toMatchObject({
      stage: undefined,
      page: 1,
      sort: "createdAt",
      caller: undefined,
    });
  });
});

describe("createContact", () => {
  it("normalizes the phone and assigns a caller's own contact to them", async () => {
    signedInAs(nimali);
    const res = await createContact({ ...fields, phone: "+94 71 111 1111", campaignId, assignedTo: String(kasun._id) });
    expect(res.ok).toBe(true);
    expect(await Contact.findOne()).toMatchObject({ phone: "0711111111", assignedTo: nimali._id, stage: "new" });
  });

  it("rejects callers who aren't on the campaign", async () => {
    signedInAs(outsider);
    expect(await createContact({ ...fields, campaignId })).toEqual({ ok: false, error: "Campaign not found." });
  });

  it("blocks duplicates in the same campaign and warns about other campaigns", async () => {
    signedInAs(owner);
    await createContact({ ...fields, campaignId: otherCampaignId });
    expect(await createContact({ ...fields, phone: "711111111", campaignId: otherCampaignId })).toMatchObject({ ok: false });
    const res = await createContact({ ...fields, campaignId });
    expect(res).toMatchObject({ ok: true, warning: "This number is also in: Seminar list." });
  });

  it("owners can only assign callers who are on the campaign", async () => {
    signedInAs(owner);
    expect(await createContact({ ...fields, campaignId, assignedTo: String(outsider._id) })).toMatchObject({ ok: false });
    expect(await createContact({ ...fields, campaignId, assignedTo: String(kasun._id) })).toMatchObject({ ok: true });
  });
});

describe("updateContact", () => {
  let contactId: string;
  beforeEach(async () => {
    contactId = String((await Contact.create({ campaignId, ...fields, tags: [], assignedTo: nimali._id }))._id);
  });

  it("callers can't touch someone else's contact or reassign their own", async () => {
    signedInAs(kasun);
    expect(await updateContact({ ...fields, id: contactId, name: "Hijacked" })).toEqual({ ok: false, error: "Contact not found." });

    signedInAs(nimali);
    expect(await updateContact({ ...fields, id: contactId, assignedTo: String(kasun._id), tags: "a, b, a" })).toEqual({ ok: true });
    expect(await Contact.findById(contactId)).toMatchObject({ assignedTo: nimali._id, tags: ["a", "b"] });
  });

  it("records stage changes and reassignments in the audit log, without personal data", async () => {
    signedInAs(owner);
    await updateContact({ ...fields, id: contactId, stage: "interested", assignedTo: String(kasun._id) });
    const contact = await Contact.findById(contactId);
    expect(contact).toMatchObject({ stage: "interested", assignedTo: kasun._id });
    const events = await AuditEvent.find().sort({ action: 1 }).lean();
    expect(events.map((e) => [e.action, e.before, e.after])).toEqual([
      ["contact.reassign", { assignedTo: String(nimali._id) }, { assignedTo: String(kasun._id) }],
      ["contact.stage", { stage: "new" }, { stage: "interested" }],
    ]);
    expect(JSON.stringify(events)).not.toContain(fields.phone);
  });
});

describe("bulkUpdateContacts", () => {
  it("is owner-only", async () => {
    signedInAs(nimali);
    await expect(bulkUpdateContacts({ action: "addTag", ids: [String(owner._id)], tag: "x" })).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("reassigns, changes stage and tags, auditing only real changes", async () => {
    const docs = await Contact.create([
      { campaignId, name: "A", phone: "0710000001", assignedTo: nimali._id },
      { campaignId, name: "B", phone: "0710000002", assignedTo: kasun._id, stage: "enrolled" },
    ]);
    const ids = docs.map((d) => String(d._id));
    signedInAs(owner);

    expect(await bulkUpdateContacts({ action: "reassign", ids, assignedTo: String(outsider._id) })).toMatchObject({ ok: false });
    expect(await bulkUpdateContacts({ action: "reassign", ids, assignedTo: String(kasun._id) })).toEqual({ ok: true, changed: 1 });
    expect(await bulkUpdateContacts({ action: "stage", ids, stage: "enrolled" })).toEqual({ ok: true, changed: 1 });
    expect(await bulkUpdateContacts({ action: "addTag", ids, tag: "vip" })).toEqual({ ok: true, changed: 2 });

    const after = await Contact.find().sort({ name: 1 }).lean();
    expect(after.map((c) => [String(c.assignedTo), c.stage, c.tags])).toEqual([
      [String(kasun._id), "enrolled", ["vip"]],
      [String(kasun._id), "enrolled", ["vip"]],
    ]);
    const audit = await AuditEvent.find().sort({ action: 1 }).lean();
    expect(audit.map((e) => [e.action, e.before])).toEqual([
      ["contact.bulk_reassign", { assignedTo: { [ids[0]]: String(nimali._id) } }],
      ["contact.bulk_stage", { stage: { [ids[0]]: "new" } }],
    ]);
  });
});

describe("setContactStage (pipeline)", () => {
  it("is owner-only, audits real changes with the contact id, and ignores no-ops", async () => {
    const c = await Contact.create({ campaignId, name: "P", phone: "0715555555", assignedTo: nimali._id });
    signedInAs(nimali);
    await expect(setContactStage({ id: String(c._id), stage: "enrolled" })).rejects.toThrow(/^REDIRECT \/$/);

    signedInAs(owner);
    expect(await setContactStage({ id: String(c._id), stage: "interested" })).toEqual({ ok: true });
    expect(await setContactStage({ id: String(c._id), stage: "interested" })).toEqual({ ok: true });
    expect((await Contact.findById(c._id).lean())?.stage).toBe("interested");
    const events = await AuditEvent.find({ action: "contact.stage" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: c._id, before: { stage: "new" }, after: { stage: "interested", via: "pipeline" } });
  });
});
