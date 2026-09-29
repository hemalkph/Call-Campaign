import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import "@/test/mongo";
import { AuditEvent } from "@/lib/models/audit-event";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { ImportBatch } from "@/lib/models/import-batch";
import { User } from "@/lib/models/user";
import { signedInAs } from "@/test/auth";
import { Call } from "@/lib/models/call";
import { exportPage } from "./export-actions";
import { finishImport, findExistingPhones, importChunk, startImport } from "./import-actions";

type U = InstanceType<typeof User>;
let owner: U, nimali: U, kasun: U;
let campaignId: string;

const settings = (key: string, extra: object = {}) => ({
  key,
  campaignId,
  fileName: "leads.csv",
  mapping: { name: "Name", phone: "Phone" },
  strategy: "balanced",
  defaultTags: "seminar-2026",
  defaultSource: "Seminar",
  totalRows: 4,
  rejectedInBrowser: {},
  ...extra,
});
const row = (n: number, name: string, phone: string, extra: object = {}) => ({ row: n, values: { name, phone, ...extra } });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Campaign.deleteMany({}), Contact.deleteMany({}), ImportBatch.deleteMany({}), AuditEvent.deleteMany({}), Call.deleteMany({})]);
  const mk = (name: string, role: "owner" | "caller") => User.create({ name, email: `${name}@example.test`, passwordHash: "x", role, mustChangePassword: false });
  [owner, nimali, kasun] = await Promise.all([mk("owner", "owner"), mk("nimali", "caller"), mk("kasun", "caller")]);
  const c = await Campaign.create({
    name: "Oct",
    classLabel: "A/L",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    callers: [{ userId: nimali._id }, { userId: kasun._id }],
  });
  campaignId = String(c._id);
  signedInAs(owner);
});

describe("import", () => {
  it("is owner-only", async () => {
    signedInAs(nimali);
    await expect(startImport(settings(randomUUID()))).rejects.toThrow(/^REDIRECT \/$/);
    await expect(importChunk({ key: randomUUID(), index: 0, rows: [row(2, "A", "0711111111")] })).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("imports chunks, re-validates rows on the server and applies defaults", async () => {
    const key = randomUUID();
    expect(await startImport(settings(key))).toEqual({ ok: true, doneChunks: [] });
    const res = await importChunk({
      key,
      index: 0,
      rows: [row(2, "A", "711111111", { tags: "x" }), row(3, "", "0712222222"), row(4, "C", "bad"), row(5, "D", "0711111111")],
    });
    expect(res).toEqual({ ok: true, created: [2], skipped: [], invalid: [3, 4, 5] });
    expect(await Contact.findOne().lean()).toMatchObject({ phone: "0711111111", tags: ["x", "seminar-2026"], source: "Seminar" });
  });

  it("never imports a retried chunk twice", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const chunk = { key, index: 0, rows: [row(2, "A", "0711111111"), row(3, "B", "0712222222")] };
    const first = await importChunk(chunk);
    const again = await importChunk(chunk);
    expect(again).toEqual(first);
    expect(await Contact.countDocuments()).toBe(2);

    // Same key sent again (e.g. the page retried "start"): the done chunks come back.
    expect(await startImport(settings(key))).toEqual({ ok: true, doneChunks: [0] });
  });

  it("counts rows left behind by a crashed attempt as created, not skipped", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const batch = await ImportBatch.findOne({ key });
    // Simulate: the first attempt inserted row 2, then died before recording the chunk.
    await Contact.create({ campaignId, name: "A", phone: "0711111111", importBatchId: batch!._id });
    await Contact.create({ campaignId, name: "Old", phone: "0719999999" }); // from an earlier import

    const res = await importChunk({ key, index: 0, rows: [row(2, "A", "0711111111"), row(3, "Old", "0719999999"), row(4, "C", "0713333333")] });
    expect(res).toEqual({ ok: true, created: [2, 4], skipped: [3], invalid: [] });
    expect(await Contact.countDocuments()).toBe(3);
  });

  it("balances assignments across chunks and callers' existing workload", async () => {
    await Contact.create(
      Array.from({ length: 3 }, (_, i) => ({ campaignId, name: `N${i}`, phone: `071000000${i}`, assignedTo: nimali._id })),
    );
    const key = randomUUID();
    await startImport(settings(key));
    await importChunk({ key, index: 0, rows: [2, 3, 4].map((n) => row(n, `R${n}`, `07200000${n}0`)) });
    await importChunk({ key, index: 1, rows: [5, 6, 7].map((n) => row(n, `R${n}`, `07200000${n}0`)) });
    const perCaller = await Contact.aggregate([{ $group: { _id: "$assignedTo", n: { $sum: 1 } } }]);
    expect(Object.fromEntries(perCaller.map((p) => [String(p._id), p.n]))).toEqual({ [String(nimali._id)]: 5, [String(kasun._id)]: 4 }); // 3+2 vs 0+4: never more than 1 apart
  });

  it("finishes once, audits counts without personal data, and reports existing phones", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    await importChunk({ key, index: 0, rows: [row(2, "Amal Test", "0711111111")] });
    expect(await finishImport(key)).toEqual({ ok: true, created: 1, skipped: 0, invalid: 0 });
    await finishImport(key);
    expect(await AuditEvent.countDocuments({ action: "import.finish" })).toBe(1);
    const log = JSON.stringify(await AuditEvent.find().lean()) + JSON.stringify(await ImportBatch.find().lean());
    expect(log).not.toMatch(/0711111111|Amal Test/);

    expect(await findExistingPhones({ campaignId, phones: ["0711111111", "0712222222"] })).toEqual({ ok: true, phones: ["0711111111"] });
  });

  it("rejects a key reused for another campaign and a caller not on the campaign", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const other = await Campaign.create({ name: "X", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-12-31" });
    expect(await startImport(settings(key, { campaignId: String(other._id) }))).toMatchObject({ ok: false });
    expect(await startImport(settings(randomUUID(), { strategy: "one", oneCallerId: String(owner._id) }))).toMatchObject({ ok: false });
  });
});

describe("export", () => {
  beforeEach(async () => {
    await Contact.create([
      { campaignId, name: "A", phone: "0711111111", assignedTo: nimali._id, stage: "interested" },
      { campaignId, name: "B", phone: "0712222222", assignedTo: kasun._id },
    ]);
  });

  it("is owner-only", async () => {
    signedInAs(nimali);
    await expect(exportPage({ type: "calls", campaignId, params: {}, page: 0, format: "csv" })).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("respects filters and audits without the search text", async () => {
    const res = await exportPage({ type: "contacts", campaignId, params: { stage: "interested", q: "0711" }, page: 0, format: "xlsx" });
    expect(res).toMatchObject({ ok: true, total: 1, more: false, rows: [{ name: "A", phone: "0711111111", caller: "nimali", stage: "interested" }] });
    const event = await AuditEvent.findOne({ action: "export.contacts" }).lean();
    expect(event?.after).toMatchObject({ format: "xlsx", rows: 1, filters: { stage: "interested", search: "yes" } });
    expect(JSON.stringify(event)).not.toContain("0711");
  });

  it("exports the call log only for contacts in view, plus per-caller performance", async () => {
    const [a, b] = await Contact.find().sort({ name: 1 });
    await Call.create([
      { campaignId, contactId: a._id, callerId: nimali._id, outcome: "interested", notes: "=cmd" },
      { campaignId, contactId: b._id, callerId: kasun._id, outcome: "busy" },
    ]);
    const all = await exportPage({ type: "calls", campaignId, params: {}, page: 0, format: "csv" });
    expect(all).toMatchObject({ ok: true, total: 2 });
    const filtered = await exportPage({ type: "calls", campaignId, params: { stage: "interested" }, page: 0, format: "csv" });
    expect(filtered).toMatchObject({ ok: true, total: 1, rows: [{ contact: "A", phone: "0711111111", caller: "nimali", outcome: "interested", notes: "=cmd" }] });

    const perf = await exportPage({ type: "performance", campaignId, params: {}, page: 0, format: "xlsx" });
    expect(perf.ok && perf.rows.map((r) => [r.name, r.calls, r.reached])).toEqual([
      ["nimali", 1, 1],
      ["kasun", 1, 0],
    ]);
    expect(await AuditEvent.countDocuments({ action: { $in: ["export.calls", "export.performance"] } })).toBe(3);
  });
});
