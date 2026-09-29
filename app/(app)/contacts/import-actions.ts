"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assignRows, CHUNK_SIZE, cleanRow, IMPORT_FIELDS, type ImportField, splitTags, STRATEGIES } from "@/lib/import";
import { audit } from "@/lib/models/audit-event";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { ImportBatch } from "@/lib/models/import-batch";
import { User } from "@/lib/models/user";
import { objectId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const oid = (id: string) => new Types.ObjectId(id);
const CLOSED_STAGES = ["enrolled", "not_interested", "wrong_number", "do_not_contact"];

const fieldKeys = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]];
const cell = z.string().max(5000);

/** Phones already in this campaign, for the preview. Up to 5000 per call. */
export async function findExistingPhones(input: unknown): Promise<Result<{ phones: string[] }>> {
  await requireOwner();
  const p = z.strictObject({ campaignId: objectId, phones: z.array(z.string().regex(/^0\d{9}$/)).max(5000) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const phones = await Contact.distinct("phone", { campaignId: oid(p.data.campaignId), phone: { $in: p.data.phones } });
  return { ok: true, phones };
}

const startSchema = z.strictObject({
  key: z.uuid(),
  campaignId: objectId,
  fileName: z.string().max(200),
  mapping: z.partialRecord(z.enum(fieldKeys), z.string().max(200)),
  strategy: z.enum(STRATEGIES),
  oneCallerId: objectId.optional(),
  defaultTags: z.string().max(500),
  defaultSource: z.string().trim().max(80),
  totalRows: z.number().int().min(0).max(100_000),
  rejectedInBrowser: z.record(z.string(), z.number().int().min(0)),
});

/** Creates the batch, or returns the existing one when the same key is sent again. */
export async function startImport(input: unknown): Promise<Result<{ doneChunks: number[] }>> {
  const me = await requireOwner();
  const p = startSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid import settings." };
  const d = p.data;

  const campaign = await Campaign.findById(d.campaignId, { callers: 1 }).lean();
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (d.strategy === "one" && !campaign.callers.some((c) => String(c.userId) === d.oneCallerId))
    return { ok: false, error: "Pick a caller who is on this campaign." };

  const existing = await ImportBatch.findOne({ key: d.key }, { campaignId: 1, chunks: 1 }).lean();
  if (existing) {
    if (String(existing.campaignId) !== d.campaignId) return { ok: false, error: "Import key belongs to another campaign." };
    return { ok: true, doneChunks: existing.chunks.map((c) => c.index) };
  }

  try {
    const batch = await ImportBatch.create({ ...d, defaultTags: splitTags(d.defaultTags), createdBy: me.id });
    await audit({
      actorId: me.id,
      action: "import.start",
      entity: "importBatches",
      entityId: batch._id,
      after: { campaignId: d.campaignId, fileName: d.fileName, totalRows: d.totalRows, strategy: d.strategy },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e; // a parallel retry created it first
  }
  return { ok: true, doneChunks: [] };
}

const chunkSchema = z.strictObject({
  key: z.uuid(),
  index: z.number().int().min(0).max(10_000),
  rows: z
    .array(z.strictObject({ row: z.number().int().min(2), values: z.partialRecord(z.enum(fieldKeys), cell) }))
    .min(1)
    .max(CHUNK_SIZE),
});

type ChunkResult = { created: number[]; skipped: number[]; invalid: number[] };

/**
 * Imports one chunk. Safe to retry: a recorded chunk returns its saved result, and rows already
 * inserted by an earlier attempt of this batch still count as created.
 */
export async function importChunk(input: unknown): Promise<Result<ChunkResult>> {
  await requireOwner();
  const p = chunkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid chunk." };
  const { key, index, rows } = p.data;

  const batch = await ImportBatch.findOne({ key });
  if (!batch) return { ok: false, error: "Import not found — start again." };
  const done = batch.chunks.find((c) => c.index === index);
  if (done) return { ok: true, created: done.created, skipped: done.skipped, invalid: done.invalid };

  // Never trust the browser's preview: validate every row again.
  const invalid: number[] = [];
  const clean = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = cleanRow(r);
    if (!c.ok || seen.has(c.value.phone)) invalid.push(r.row);
    else {
      seen.add(c.value.phone);
      clean.push(c.value);
    }
  }

  const campaign = await Campaign.findById(batch.campaignId, { callers: 1 }).lean();
  if (!campaign) return { ok: false, error: "Campaign not found." };
  const activeCallers = await User.find({ _id: { $in: campaign.callers.map((c) => c.userId) }, active: true }, { _id: 1 }).lean();
  const callers = campaign.callers.map((c) => String(c.userId)).filter((id) => activeCallers.some((u) => String(u._id) === id));

  const already = new Set(await Contact.distinct("phone", { campaignId: batch.campaignId, phone: { $in: clean.map((c) => c.phone) } }));
  const fresh = clean.filter((c) => !already.has(c.phone));

  let openCounts: Record<string, number> = {};
  if (batch.strategy === "balanced") {
    const agg = await Contact.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { campaignId: batch.campaignId, assignedTo: { $in: callers.map(oid) }, stage: { $nin: CLOSED_STAGES } } },
      { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
    ]);
    openCounts = Object.fromEntries(agg.map((a) => [String(a._id), a.n]));
  }
  const assignees = assignRows(
    fresh.map((c) => c.row),
    batch.strategy,
    callers,
    { openCounts, one: batch.oneCallerId ? String(batch.oneCallerId) : undefined },
  );

  if (fresh.length) {
    await Contact.insertMany(
      fresh.map(({ row: _row, ...c }, i) => ({ // eslint-disable-line @typescript-eslint/no-unused-vars
        ...c,
        campaignId: batch.campaignId,
        source: c.source || batch.defaultSource,
        tags: [...new Set([...c.tags, ...batch.defaultTags])],
        assignedTo: assignees[i] ? oid(assignees[i]!) : null,
        importBatchId: batch._id,
      })),
      { ordered: false },
    ).catch((e) => {
      if (!e?.writeErrors?.every((w: { code?: number; err?: { code?: number } }) => (w.code ?? w.err?.code) === 11000)) throw e;
    });
  }

  // Whatever now exists from *this* batch counts as created (covers a retried, half-finished attempt).
  const mine = new Set(
    await Contact.distinct("phone", { importBatchId: batch._id, phone: { $in: clean.map((c) => c.phone) } }),
  );
  const result: ChunkResult = {
    created: clean.filter((c) => mine.has(c.phone)).map((c) => c.row),
    skipped: clean.filter((c) => !mine.has(c.phone)).map((c) => c.row),
    invalid,
  };
  await ImportBatch.updateOne({ _id: batch._id, "chunks.index": { $ne: index } }, { $push: { chunks: { index, ...result } } });
  return { ok: true, ...result };
}

export async function finishImport(input: unknown): Promise<Result<{ created: number; skipped: number; invalid: number }>> {
  const me = await requireOwner();
  const key = z.uuid().safeParse(input);
  if (!key.success) return { ok: false, error: "Invalid request." };
  const batch = await ImportBatch.findOne({ key: key.data });
  if (!batch) return { ok: false, error: "Import not found." };

  const sum = (k: "created" | "skipped" | "invalid") => batch.chunks.reduce((n, c) => n + c[k].length, 0);
  const counts = { created: sum("created"), skipped: sum("skipped"), invalid: sum("invalid") };
  if (batch.status !== "done") {
    batch.status = "done";
    batch.finishedAt = new Date();
    await batch.save();
    await audit({
      actorId: me.id,
      action: "import.finish",
      entity: "importBatches",
      entityId: batch._id,
      after: { ...counts, rejectedInBrowser: batch.rejectedInBrowser },
    });
  }
  revalidatePath("/contacts");
  revalidatePath("/campaigns");
  return { ok: true, ...counts };
}
