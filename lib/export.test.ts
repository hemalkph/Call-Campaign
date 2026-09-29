import Papa from "papaparse";
import * as XLSX from "xlsx";
import { expect, it } from "vitest";
import { type Column, toCsv, toXlsx } from "./export";

type Row = { name: string; phone: string; n: number | null };
const columns: Column<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Phone", value: (r) => r.phone, text: true },
  { header: "Count", value: (r) => r.n },
];
const rows: Row[] = [
  { name: "කමල් පෙරේරා", phone: "0712345678", n: 3 },
  { name: '=HYPERLINK("http://evil")', phone: "0771234567", n: null },
  { name: "Perera, \"Kamal\"\nline2", phone: "0112345678", n: 0 },
  { name: "+1 call me", phone: "0701234567", n: 1 },
  { name: "-2", phone: "0761234567", n: 2 },
  { name: "@SUM(A1)", phone: "0751234567", n: 2 },
];

it("CSV starts with a BOM, round-trips quotes and Sinhala, and neutralizes formulas", () => {
  const csv = toCsv(rows, columns);
  expect(csv.startsWith("﻿Name,Phone,Count\r\n")).toBe(true);
  const parsed = Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data;
  expect(parsed[1]).toEqual(["කමල් පෙරේරා", "0712345678", "3"]);
  expect(parsed[3][0]).toBe('Perera, "Kamal"\nline2');
  expect(parsed.slice(1).map((r) => r[0][0])).not.toContain("=");
  expect(parsed[2][0]).toBe(`'=HYPERLINK("http://evil")`);
  expect([parsed[4][0], parsed[5][0], parsed[6][0]]).toEqual(["'+1 call me", "'-2", "'@SUM(A1)"]);
  expect(parsed[2][2]).toBe(""); // null → empty
});

it("XLSX stores phones as text so the leading 0 survives", () => {
  const wb = XLSX.read(toXlsx(rows, columns, "Contacts"), { type: "array" });
  const ws = wb.Sheets.Contacts;
  expect(ws.B2).toMatchObject({ t: "s", v: "0712345678" });
  expect(ws.C2).toMatchObject({ t: "n", v: 3 });
  expect(ws.A2.v).toBe("කමල් පෙරේරා");
  expect(ws.A3).toMatchObject({ t: "s" }); // formula-looking text stays text, not a formula
  expect(ws.A3.f).toBeUndefined();
});
