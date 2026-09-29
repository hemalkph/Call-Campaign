// CSV / XLSX file building. Runs in the browser; client-safe.
import * as XLSX from "xlsx";

export { EXPORT_TYPES, type ExportRow, type ExportType } from "./vocab";

export type Column<T> = { header: string; value: (row: T) => string | number | null | undefined; text?: boolean };

/** Stops Excel/Sheets from treating a cell as a formula (CSV injection). */
export function safeCell(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** UTF-8 with BOM (so Excel shows Sinhala correctly), CRLF line endings, injection-safe. */
export function toCsv<T>(rows: T[], columns: Column<T>[]) {
  const line = (cells: string[]) => cells.map((c) => quote(safeCell(c))).join(",");
  return (
    "﻿" +
    [line(columns.map((c) => c.header)), ...rows.map((r) => line(columns.map((c) => String(c.value(r) ?? ""))))].join("\r\n") +
    "\r\n"
  );
}

/** One sheet. Columns marked `text` (phones) are stored as text so leading zeros survive. */
export function toXlsx<T>(rows: T[], columns: Column<T>[], sheetName = "Export"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r) ?? "")),
  ]);
  columns.forEach((c, ci) => {
    if (!c.text) return;
    for (let ri = 1; ri <= rows.length; ri++) {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (cell) Object.assign(cell, { t: "s", v: String(cell.v), z: "@" });
    }
  });
  ws["!cols"] = columns.map((c) => ({ wch: Math.min(40, Math.max(10, c.header.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function download(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CSV_TYPE = "text/csv;charset=utf-8";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
