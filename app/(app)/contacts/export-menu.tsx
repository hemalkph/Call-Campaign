"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ListParams } from "@/lib/contacts-query";
import { type Column, CSV_TYPE, download, type ExportRow, type ExportType, toCsv, toXlsx, XLSX_TYPE } from "@/lib/export";
import { fmtDateTime } from "@/lib/time";
import { OUTCOME_LABEL, type Outcome, STAGE_META, type Stage } from "@/lib/vocab";
import { exportPage } from "./export-actions";

const str = (k: string): Column<ExportRow>["value"] => (r) => r[k] ?? "";
const when = (k: string): Column<ExportRow>["value"] => (r) => fmtDateTime(r[k] as string | null);
const outcome = (k: string): Column<ExportRow>["value"] => (r) => (r[k] ? OUTCOME_LABEL[r[k] as Outcome] : "");
const phone = (k: string, header: string): Column<ExportRow> => ({ header, value: str(k), text: true });
const contactCols: Column<ExportRow>[] = [
  { header: "Contact", value: str("contact") },
  phone("phone", "Phone"),
  { header: "Caller", value: str("caller") },
];

const EXPORTS: Record<ExportType, { label: string; sheet: string; columns: Column<ExportRow>[] }> = {
  contacts: {
    label: "Contacts",
    sheet: "Contacts",
    columns: [
      { header: "Name", value: str("name") },
      phone("phone", "Phone"),
      phone("altPhone", "Parent phone"),
      { header: "School", value: str("school") },
      { header: "District", value: str("district") },
      { header: "Grade / batch", value: str("gradeOrBatch") },
      { header: "Source", value: str("source") },
      { header: "Tags", value: str("tags") },
      { header: "Stage", value: (r) => STAGE_META[r.stage as Stage]?.label ?? r.stage },
      { header: "Caller", value: str("caller") },
      { header: "Last call", value: when("lastCallAt") },
      { header: "Last outcome", value: outcome("lastOutcome") },
      { header: "Next callback", value: when("nextCallbackAt") },
      { header: "Last WhatsApp", value: when("lastWhatsappAt") },
      { header: "Notes", value: str("notes") },
      { header: "Added", value: when("createdAt") },
    ],
  },
  calls: {
    label: "Call log",
    sheet: "Calls",
    columns: [
      { header: "Called at", value: when("calledAt") },
      ...contactCols,
      { header: "Outcome", value: outcome("outcome") },
      { header: "Duration (sec)", value: str("durationSec") },
      { header: "Notes", value: str("notes") },
    ],
  },
  whatsapp: {
    label: "WhatsApp log",
    sheet: "WhatsApp",
    columns: [{ header: "Sent at", value: when("sentAt") }, ...contactCols, { header: "Template", value: str("template") }, { header: "Note", value: str("note") }],
  },
  callbacks: {
    label: "Callbacks",
    sheet: "Callbacks",
    columns: [
      { header: "Due", value: when("dueAt") },
      ...contactCols,
      { header: "Status", value: str("status") },
      { header: "Note", value: str("note") },
      { header: "Cancel reason", value: str("reason") },
      { header: "Created", value: when("createdAt") },
    ],
  },
  performance: {
    label: "Per-caller performance",
    sheet: "Performance",
    columns: [
      { header: "Caller", value: str("name") },
      { header: "Daily target", value: str("target") },
      { header: "Calls today", value: str("callsToday") },
      { header: "Reached today", value: str("reachedToday") },
      { header: "Calls (all)", value: str("calls") },
      { header: "Reached (all)", value: str("reached") },
      { header: "Reached %", value: (r) => (r.calls ? Math.round((Number(r.reached) / Number(r.calls)) * 100) : "") },
      { header: "Contacts", value: str("contacts") },
      { header: "Open", value: str("open") },
      { header: "Interested", value: str("interested") },
      { header: "Enrolled", value: str("enrolled") },
      { header: "Pending callbacks", value: str("pendingCallbacks") },
      { header: "Overdue callbacks", value: str("overdueCallbacks") },
      { header: "WhatsApp sent", value: str("whatsapp") },
    ],
  },
};

export function ExportMenu({ campaignId, params }: { campaignId: string; params: ListParams }) {
  const [busy, setBusy] = useState(false);

  async function run(type: ExportType, format: "csv" | "xlsx") {
    const spec = EXPORTS[type];
    setBusy(true);
    const toastId = toast.loading(`Preparing ${spec.label.toLowerCase()}…`);
    try {
      const rows: ExportRow[] = [];
      let name = "campaign";
      for (let page = 0; ; page++) {
        const res = await exportPage({ type, campaignId, params, page, format });
        if (!res.ok) throw new Error(res.error);
        rows.push(...res.rows);
        name = res.campaignName;
        if (res.total) toast.loading(`Preparing ${spec.label.toLowerCase()}… ${rows.length} of ${res.total}`, { id: toastId });
        if (!res.more) break;
      }
      const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
      const file = `${name.replace(/[^\p{L}\p{N}]+/gu, "-")}-${spec.sheet.toLowerCase()}-${stamp}`;
      if (format === "csv") download(toCsv(rows, spec.columns), `${file}.csv`, CSV_TYPE);
      else download(toXlsx(rows, spec.columns, spec.sheet), `${file}.xlsx`, XLSX_TYPE);
      toast.success(`Exported ${rows.length} rows`, { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Export failed — check your connection and try again.", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          <Download aria-hidden /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-muted-foreground">For the contacts matching your filters</DropdownMenuLabel>
        {(Object.keys(EXPORTS) as ExportType[]).map((type) => (
          <div key={type}>
            {type === "performance" && <DropdownMenuSeparator />}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{EXPORTS[type].label}{type === "performance" && " (whole campaign)"}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => run(type, "xlsx")} aria-label={`${EXPORTS[type].label} as Excel`}>
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => run(type, "csv")} aria-label={`${EXPORTS[type].label} as CSV`}>
                  CSV (.csv)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
