// CSV import rules shared by the browser (preview) and the server (the real check). Client-safe.
import { normalizePhone } from "./phone";
import { DISTRICTS } from "./vocab";

export const CHUNK_SIZE = 250;
const CHUNK_BYTES = 700_000; // server actions accept 1 MB bodies; leave room for overhead
export const MAX_ROWS = 20_000;

export const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true, hints: ["name", "student", "full name", "නම", "සිසු"] },
  { key: "phone", label: "Phone", required: true, hints: ["phone", "mobile", "contact", "tel", "whatsapp", "number", "දුරකථන", "ජංගම", "අංකය"] },
  { key: "altPhone", label: "Parent's phone", hints: ["parent", "guardian", "mother", "father", "දෙමාපිය", "භාරකරු"] },
  { key: "school", label: "School", hints: ["school", "පාසල"] },
  { key: "district", label: "District", hints: ["district", "area", "city", "town", "දිස්ත්‍රික්", "ප්‍රදේශ"] },
  { key: "gradeOrBatch", label: "Grade / batch", hints: ["grade", "batch", "year", "class", "ශ්‍රේණිය", "කණ්ඩායම"] },
  { key: "source", label: "Source", hints: ["source", "from", "lead", "මූලාශ්‍ර"] },
  { key: "tags", label: "Tags", hints: ["tag", "label"] },
  { key: "notes", label: "Notes", hints: ["note", "remark", "comment", "සටහන"] },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
/** Field → column index in the file. */
export type Mapping = Partial<Record<ImportField, number>>;
export type RawRow = { row: number; values: Partial<Record<ImportField, string>> };

export type RejectCode = "missing_name" | "invalid_phone" | "duplicate_in_file" | "already_in_campaign";
export const REJECT_LABEL: Record<RejectCode, string> = {
  missing_name: "Missing name",
  invalid_phone: "Invalid phone",
  duplicate_in_file: "Duplicate in file",
  already_in_campaign: "Already in campaign",
};

export type CleanRow = {
  row: number;
  name: string;
  phone: string;
  altPhone?: string;
  school: string;
  district: string;
  gradeOrBatch: string;
  source: string;
  tags: string[];
  notes: string;
};

const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase();

/** Picks a column for each field from the header names (English or Sinhala). Each column is used once. */
export function guessMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const mapping: Mapping = {};
  // Parent's phone first, so "Parent phone" isn't grabbed by the phone field.
  const order = ["altPhone", ...IMPORT_FIELDS.map((f) => f.key).filter((k) => k !== "altPhone")] as ImportField[];
  for (const key of order) {
    const { hints } = IMPORT_FIELDS.find((f) => f.key === key)!;
    const i = headers.findIndex((h, idx) => !used.has(idx) && hints.some((hint) => norm(h).includes(hint)));
    if (i >= 0) {
      mapping[key] = i;
      used.add(i);
    }
  }
  return mapping;
}

export function mapRows(data: string[][], mapping: Mapping): RawRow[] {
  return data.map((cells, i) => ({
    row: i + 2, // spreadsheet row number: header is row 1
    values: Object.fromEntries(
      Object.entries(mapping).map(([field, col]) => [field, (cells[col as number] ?? "").trim()]),
    ),
  }));
}

const cut = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);
const districtByLower = new Map(DISTRICTS.map((d) => [d.toLowerCase(), d]));

/** Validates and normalizes one row. Invalid parent phones are dropped rather than rejecting the row. */
export function cleanRow(r: RawRow): { ok: true; value: CleanRow } | { ok: false; code: "missing_name" | "invalid_phone" } {
  const v = r.values;
  const name = cut(v.name, 120);
  if (!name) return { ok: false, code: "missing_name" };
  const phone = normalizePhone(v.phone);
  if (!phone.ok) return { ok: false, code: "invalid_phone" };
  const alt = normalizePhone(v.altPhone);
  const district = cut(v.district, 60);
  return {
    ok: true,
    value: {
      row: r.row,
      name,
      phone: phone.phone,
      altPhone: alt.ok && alt.phone !== phone.phone ? alt.phone : undefined,
      school: cut(v.school, 120),
      district: districtByLower.get(district.toLowerCase()) ?? district,
      gradeOrBatch: cut(v.gradeOrBatch, 60),
      source: cut(v.source, 80),
      tags: splitTags(v.tags ?? ""),
      notes: cut(v.notes, 5000),
    },
  };
}

export const splitTags = (s: string) =>
  [...new Set(s.split(/[,;|]/).map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

/** Browser-side preview: splits rows into importable ones and rejects (with reasons). */
export function prepareRows(rows: RawRow[], existing: Set<string> = new Set()) {
  const seen = new Set<string>();
  const ok: RawRow[] = [];
  const rejected: { row: RawRow; code: RejectCode }[] = [];
  for (const r of rows) {
    const c = cleanRow(r);
    if (!c.ok) rejected.push({ row: r, code: c.code });
    else if (seen.has(c.value.phone)) rejected.push({ row: r, code: "duplicate_in_file" });
    else if (existing.has(c.value.phone)) rejected.push({ row: r, code: "already_in_campaign" });
    else {
      seen.add(c.value.phone);
      ok.push(r);
    }
  }
  return { ok, rejected };
}

/** Splits rows into upload chunks of at most CHUNK_SIZE rows and ~700 KB. */
export function chunkRows(rows: RawRow[]): RawRow[][] {
  const chunks: RawRow[][] = [];
  let current: RawRow[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = new TextEncoder().encode(JSON.stringify(r)).length;
    if (current.length && (current.length >= CHUNK_SIZE || bytes + size > CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(r);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ---- Assignment ----

export const STRATEGIES = ["balanced", "round_robin", "one", "none"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  balanced: "Balanced — fewest open contacts first",
  round_robin: "Round-robin — take turns in file order",
  one: "All to one caller",
  none: "Leave unassigned",
};

/**
 * Chooses a caller for each new row. Round-robin uses the spreadsheet row number, so a retried
 * chunk gets the same answer; balanced tops up whoever has the fewest open contacts.
 */
export function assignRows(
  rowNumbers: number[],
  strategy: Strategy,
  callers: string[],
  opts: { openCounts?: Record<string, number>; one?: string } = {},
): (string | null)[] {
  if (strategy === "none" || !callers.length) return rowNumbers.map(() => null);
  if (strategy === "one") return rowNumbers.map(() => opts.one ?? null);
  if (strategy === "round_robin") return rowNumbers.map((n) => callers[n % callers.length]);
  const counts = new Map(callers.map((c) => [c, opts.openCounts?.[c] ?? 0]));
  return rowNumbers.map(() => {
    let best = callers[0];
    for (const c of callers) if (counts.get(c)! < counts.get(best)!) best = c;
    counts.set(best, counts.get(best)! + 1);
    return best;
  });
}
