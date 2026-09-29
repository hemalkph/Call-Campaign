import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { assignRows, chunkRows, cleanRow, guessMapping, mapRows, prepareRows } from "./import";

// Same options the wizard uses.
const parse = (text: string) => Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;

describe("CSV parsing and mapping", () => {
  it("handles a BOM, quotes, commas inside quotes and Sinhala headers", () => {
    const csv =
      "﻿නම,දුරකථන අංකය,පාසල,දෙමාපිය දුරකථන\r\n" +
      '"Perera, Kamal",712345678,"Test ""Central"" College",0771234567\r\n' +
      "සුනිල් ද සිල්වා,+94 76 123 4567,,\r\n\r\n";
    const [headers, ...data] = parse(csv);
    const mapping = guessMapping(headers);
    expect(mapping).toEqual({ name: 0, phone: 1, school: 2, altPhone: 3 });

    const rows = mapRows(data, mapping);
    expect(rows).toHaveLength(2);
    expect(cleanRow(rows[0])).toMatchObject({
      ok: true,
      value: { row: 2, name: "Perera, Kamal", phone: "0712345678", school: 'Test "Central" College', altPhone: "0771234567" },
    });
    expect(cleanRow(rows[1])).toMatchObject({ ok: true, value: { name: "සුනිල් ද සිල්වා", phone: "0761234567" } });
  });

  it("guesses common English headers without reusing a column", () => {
    expect(guessMapping(["Student Name", "Mobile", "Parent Phone", "School", "District", "Batch", "Source", "Remarks"])).toEqual({
      name: 0,
      phone: 1,
      altPhone: 2,
      school: 3,
      district: 4,
      gradeOrBatch: 5,
      source: 6,
      notes: 7,
    });
  });

  it("classifies rows for the preview", () => {
    const rows = mapRows(
      [
        ["A", "0711111111"],
        ["", "0712222222"],
        ["C", "12345"],
        ["D", "711111111"], // same number as A once the 0 is restored
        ["E", "0713333333"],
        ["F", "0714444444"],
      ],
      { name: 0, phone: 1 },
    );
    const { ok, rejected } = prepareRows(rows, new Set(["0713333333"]));
    expect(ok.map((r) => r.values.name)).toEqual(["A", "F"]);
    expect(rejected.map((r) => [r.row.row, r.code])).toEqual([
      [3, "missing_name"],
      [4, "invalid_phone"],
      [5, "duplicate_in_file"],
      [6, "already_in_campaign"],
    ]);
  });

  it("normalizes districts, splits tags and drops a bad parent phone", () => {
    const r = cleanRow({ row: 2, values: { name: "A", phone: "0711111111", district: "kandy", tags: "a; b, a|c", altPhone: "n/a" } });
    expect(r).toMatchObject({ ok: true, value: { district: "Kandy", tags: ["a", "b", "c"], altPhone: undefined } });
  });
});

describe("assignRows", () => {
  const callers = ["n", "k", "s"];

  it("balanced tops up whoever has the fewest open contacts", () => {
    const out = assignRows([2, 3, 4, 5, 6, 7], "balanced", callers, { openCounts: { n: 5, k: 2, s: 0 } });
    const count = (c: string) => out.filter((x) => x === c).length;
    expect([count("n"), count("k"), count("s")]).toEqual([0, 2, 4]); // ends at 5 / 4 / 4
  });

  it("round-robin is stable across retries of the same rows", () => {
    expect(assignRows([2, 3, 4, 5], "round_robin", callers)).toEqual(["s", "n", "k", "s"]);
    expect(assignRows([4, 5], "round_robin", callers)).toEqual(["k", "s"]);
  });

  it("supports one caller and unassigned", () => {
    expect(assignRows([2, 3], "one", callers, { one: "k" })).toEqual(["k", "k"]);
    expect(assignRows([2, 3], "none", callers)).toEqual([null, null]);
    expect(assignRows([2], "balanced", [])).toEqual([null]);
  });
});

it("chunks by row count and by size", () => {
  const small = Array.from({ length: 600 }, (_, i) => ({ row: i + 2, values: { name: "A", phone: "0711111111" } }));
  expect(chunkRows(small).map((c) => c.length)).toEqual([250, 250, 100]);
  const big = Array.from({ length: 300 }, (_, i) => ({ row: i + 2, values: { name: "A", notes: "ස".repeat(2000) } }));
  const chunks = chunkRows(big);
  expect(chunks.flat()).toHaveLength(300);
  for (const c of chunks) expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThan(750_000);
});
