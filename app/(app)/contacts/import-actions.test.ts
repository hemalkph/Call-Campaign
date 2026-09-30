import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, calls, contacts, importBatches, importChunks } from "@/lib/db";
import { signedInAs } from "@/test/auth";
import { resetDb, testDb as db } from "@/test/db";
import { makeCampaign, makeContact, makeUser, type TestUser } from "@/test/fixtures";
import { exportPage } from "./export-actions";
import { finishImport, findExistingPhones, importChunk, startImport } from "./import-actions";

let owner: TestUser, nimali: TestUser, kasun: TestUser;
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
const countContacts = async () => (await db.select().from(contacts)).length;

beforeEach(async () => {
  await resetDb();
  owner = await makeUser("owner", "owner");
  nimali = await makeUser("nimali", "caller");
  kasun = await makeUser("kasun", "caller");
  campaignId = (await makeCampaign([nimali, kasun])).id;
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
    expect((await db.select().from(contacts))[0]).toMatchObject({ phone: "0711111111", tags: ["x", "seminar-2026"], source: "Seminar" });
  });

  it("never imports a retried chunk twice", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const chunk = { key, index: 0, rows: [row(2, "A", "0711111111"), row(3, "B", "0712222222")] };
    const first = await importChunk(chunk);
    const [again, parallel] = await Promise.all([importChunk(chunk), importChunk(chunk)]);
    expect(again).toEqual(first);
    expect(parallel).toEqual(first);
    expect(await countContacts()).toBe(2);
    expect(await db.select().from(importChunks)).toHaveLength(1);

    // Same key sent again (e.g. the page retried "start"): the done chunks come back.
    expect(await startImport(settings(key))).toEqual({ ok: true, doneChunks: [0] });
  });

  it("counts rows left behind by a crashed attempt as created, not skipped", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const [batch] = await db.select().from(importBatches).where(eq(importBatches.key, key));
    // Simulate: the first attempt inserted row 2, then died before recording the chunk.
    await makeContact(campaignId, "A", { phone: "0711111111", importBatchId: batch.id });
    await makeContact(campaignId, "Old", { phone: "0719999999" }); // from an earlier import

    const res = await importChunk({ key, index: 0, rows: [row(2, "A", "0711111111"), row(3, "Old", "0719999999"), row(4, "C", "0713333333")] });
    expect(res).toEqual({ ok: true, created: [2, 4], skipped: [3], invalid: [] });
    expect(await countContacts()).toBe(3);
  });

  it("balances assignments across chunks and callers' existing workload", async () => {
    for (let i = 0; i < 3; i++) await makeContact(campaignId, `N${i}`, { assignedTo: nimali.id });
    const key = randomUUID();
    await startImport(settings(key));
    await importChunk({ key, index: 0, rows: [2, 3, 4].map((n) => row(n, `R${n}`, `07200000${n}0`)) });
    await importChunk({ key, index: 1, rows: [5, 6, 7].map((n) => row(n, `R${n}`, `07200000${n}0`)) });
    const all = await db.select().from(contacts);
    const per = (id: string) => all.filter((c) => c.assignedTo === id).length;
    expect([per(nimali.id), per(kasun.id)]).toEqual([5, 4]); // 3+2 vs 0+4: never more than 1 apart
  });

  it("finishes once, audits counts without personal data, and reports existing phones", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    await importChunk({ key, index: 0, rows: [row(2, "Amal Test", "0711111111")] });
    expect(await finishImport(key)).toEqual({ ok: true, created: 1, skipped: 0, invalid: 0 });
    await finishImport(key);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "import.finish"))).toHaveLength(1);
    const log = JSON.stringify(await db.select().from(auditEvents)) + JSON.stringify(await db.select().from(importBatches));
    expect(log).not.toMatch(/0711111111|Amal Test/);

    expect(await findExistingPhones({ campaignId, phones: ["0711111111", "0712222222"] })).toEqual({ ok: true, phones: ["0711111111"] });
  });

  it("rejects a key reused for another campaign and a caller not on the campaign", async () => {
    const key = randomUUID();
    await startImport(settings(key));
    const other = await makeCampaign([], { name: "X" });
    expect(await startImport(settings(key, { campaignId: other.id }))).toMatchObject({ ok: false });
    expect(await startImport(settings(randomUUID(), { strategy: "one", oneCallerId: owner.id }))).toMatchObject({ ok: false });
  });
});

describe("export", () => {
  beforeEach(async () => {
    await makeContact(campaignId, "A", { phone: "0711111111", assignedTo: nimali.id, stage: "interested" });
    await makeContact(campaignId, "B", { phone: "0712222222", assignedTo: kasun.id });
  });

  it("is owner-only", async () => {
    signedInAs(nimali);
    await expect(exportPage({ type: "calls", campaignId, params: {}, page: 0, format: "csv" })).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("respects filters and audits without the search text", async () => {
    const res = await exportPage({ type: "contacts", campaignId, params: { stage: "interested", q: "0711" }, page: 0, format: "xlsx" });
    expect(res).toMatchObject({ ok: true, total: 1, more: false, rows: [{ name: "A", phone: "0711111111", caller: "nimali", stage: "interested" }] });
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "export.contacts"));
    expect(event.after).toMatchObject({ format: "xlsx", rows: 1, filters: { stage: "interested", search: "yes" } });
    expect(JSON.stringify(event)).not.toContain("0711");
  });

  it("exports the call log only for contacts in view, plus per-caller performance", async () => {
    const [a, b] = await db.select().from(contacts).where(inArray(contacts.name, ["A", "B"])).orderBy(contacts.name);
    await db.insert(calls).values([
      { campaignId, contactId: a.id, callerId: nimali.id, outcome: "interested", notes: "=cmd" },
      { campaignId, contactId: b.id, callerId: kasun.id, outcome: "busy" },
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
    expect(await db.select().from(auditEvents).where(inArray(auditEvents.action, ["export.calls", "export.performance"]))).toHaveLength(3);
  });
});
