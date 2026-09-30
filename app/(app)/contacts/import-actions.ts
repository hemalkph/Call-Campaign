"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { OPEN_STAGES } from "@/lib/calling";
import { campaignCallers, campaigns, contacts, db, importBatches, importChunks, users } from "@/lib/db";
import { assignRows, CHUNK_SIZE, cleanRow, IMPORT_FIELDS, type ImportField, splitTags, STRATEGIES } from "@/lib/import";
import { recordId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fieldKeys = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]];
const cell = z.string().max(5000);

/** Phones already in this campaign, for the preview. Up to 5000 per call. */
export async function findExistingPhones(input: unknown): Promise<Result<{ phones: string[] }>> {
  await requireOwner();
  const p = z.strictObject({ campaignId: recordId, phones: z.array(z.string().regex(/^0\d{9}$/)).max(5000) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const rows = p.data.phones.length
    ? await db
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.campaignId, p.data.campaignId), inArray(contacts.phone, p.data.phones)))
    : [];
  const phones = rows.map((r) => r.phone);
  return { ok: true, phones };
}

const startSchema = z.strictObject({
  key: z.uuid(),
  campaignId: recordId,
  fileName: z.string().max(200),
  mapping: z.partialRecord(z.enum(fieldKeys), z.string().max(200)),
  strategy: z.enum(STRATEGIES),
  oneCallerId: recordId.optional(),
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

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, d.campaignId));
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (d.strategy === "one") {
    const [member] = d.oneCallerId
      ? await db
          .select({ id: campaignCallers.userId })
          .from(campaignCallers)
          .where(and(eq(campaignCallers.campaignId, d.campaignId), eq(campaignCallers.userId, d.oneCallerId)))
      : [];
    if (!member) return { ok: false, error: "Pick a caller who is on this campaign." };
  }

  // A repeated start with the same key returns the batch; the unique key makes parallel starts safe.
  const [created] = await db
    .insert(importBatches)
    .values({ ...d, defaultTags: splitTags(d.defaultTags), createdBy: me.id })
    .onConflictDoNothing({ target: importBatches.key })
    .returning({ id: importBatches.id });
  if (created) {
    await audit({
      actorId: me.id,
      action: "import.start",
      entity: "importBatches",
      entityId: created.id,
      after: { campaignId: d.campaignId, fileName: d.fileName, totalRows: d.totalRows, strategy: d.strategy },
    });
    return { ok: true, doneChunks: [] };
  }
  const [existing] = await db.select().from(importBatches).where(eq(importBatches.key, d.key));
  if (existing.campaignId !== d.campaignId) return { ok: false, error: "Import key belongs to another campaign." };
  const done = await db.select({ index: importChunks.index }).from(importChunks).where(eq(importChunks.batchId, existing.id));
  return { ok: true, doneChunks: done.map((c) => c.index).sort((a, b) => a - b) };
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

  const [batch] = await db.select().from(importBatches).where(eq(importBatches.key, key));
  if (!batch) return { ok: false, error: "Import not found — start again." };
  const recorded = async () =>
    (await db.select().from(importChunks).where(and(eq(importChunks.batchId, batch.id), eq(importChunks.index, index))))[0];
  const done = await recorded();
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

  const callers = (
    await db
      .select({ id: campaignCallers.userId })
      .from(campaignCallers)
      .innerJoin(users, eq(users.id, campaignCallers.userId))
      .where(and(eq(campaignCallers.campaignId, batch.campaignId), eq(users.active, true)))
      .orderBy(asc(campaignCallers.position))
  ).map((c) => c.id);

  const phones = clean.map((c) => c.phone);
  const already = new Set(
    phones.length
      ? (
          await db
            .select({ phone: contacts.phone })
            .from(contacts)
            .where(and(eq(contacts.campaignId, batch.campaignId), inArray(contacts.phone, phones)))
        ).map((r) => r.phone)
      : [],
  );
  const fresh = clean.filter((c) => !already.has(c.phone));

  let openCounts: Record<string, number> = {};
  if (batch.strategy === "balanced" && callers.length) {
    const rows = await db
      .select({ id: contacts.assignedTo, n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.campaignId, batch.campaignId), inArray(contacts.assignedTo, callers), inArray(contacts.stage, OPEN_STAGES)))
      .groupBy(contacts.assignedTo);
    openCounts = Object.fromEntries(rows.map((r) => [r.id!, r.n]));
  }
  const assignees = assignRows(
    fresh.map((c) => c.row),
    batch.strategy,
    callers,
    { openCounts, one: batch.oneCallerId ?? undefined },
  );

  if (fresh.length)
    await db
      .insert(contacts)
      .values(
        fresh.map(({ row: _row, ...c }, i) => ({ // eslint-disable-line @typescript-eslint/no-unused-vars
          ...c,
          altPhone: c.altPhone ?? null,
          campaignId: batch.campaignId,
          source: c.source || batch.defaultSource,
          tags: [...new Set([...c.tags, ...batch.defaultTags])],
          assignedTo: assignees[i],
          importBatchId: batch.id,
        })),
      )
      .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] }); // added meanwhile by someone else → skipped

  // Whatever now exists from *this* batch counts as created (covers a retried, half-finished attempt).
  const mine = new Set(
    phones.length
      ? (
          await db
            .select({ phone: contacts.phone })
            .from(contacts)
            .where(and(eq(contacts.importBatchId, batch.id), inArray(contacts.phone, phones)))
        ).map((r) => r.phone)
      : [],
  );
  const result: ChunkResult = {
    created: clean.filter((c) => mine.has(c.phone)).map((c) => c.row),
    skipped: clean.filter((c) => !mine.has(c.phone)).map((c) => c.row),
    invalid,
  };
  // The (batch, index) primary key records each chunk once, even if two retries race.
  await db.insert(importChunks).values({ batchId: batch.id, index, ...result }).onConflictDoNothing();
  const saved = (await recorded())!;
  return { ok: true, created: saved.created, skipped: saved.skipped, invalid: saved.invalid };
}

export async function finishImport(input: unknown): Promise<Result<{ created: number; skipped: number; invalid: number }>> {
  const me = await requireOwner();
  const key = z.uuid().safeParse(input);
  if (!key.success) return { ok: false, error: "Invalid request." };
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.key, key.data));
  if (!batch) return { ok: false, error: "Import not found." };

  const [counts] = await db
    .select({
      created: sql<number>`coalesce(sum(cardinality(${importChunks.created})), 0)::int`,
      skipped: sql<number>`coalesce(sum(cardinality(${importChunks.skipped})), 0)::int`,
      invalid: sql<number>`coalesce(sum(cardinality(${importChunks.invalid})), 0)::int`,
    })
    .from(importChunks)
    .where(eq(importChunks.batchId, batch.id));
  // Only the first finish flips the status, so it's audited once.
  const finished = await db
    .update(importBatches)
    .set({ status: "done", finishedAt: new Date() })
    .where(and(eq(importBatches.id, batch.id), eq(importBatches.status, "running")))
    .returning({ id: importBatches.id });
  if (finished.length)
    await audit({
      actorId: me.id,
      action: "import.finish",
      entity: "importBatches",
      entityId: batch.id,
      after: { ...counts, rejectedInBrowser: batch.rejectedInBrowser },
    });
  revalidatePath("/contacts");
  revalidatePath("/campaigns");
  return { ok: true, ...counts };
}
