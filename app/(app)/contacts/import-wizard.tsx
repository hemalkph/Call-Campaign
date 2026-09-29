"use client";

import { CheckCircle2, Download, FileUp, RotateCcw, Upload } from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CSV_TYPE, download, toCsv } from "@/lib/export";
import {
  chunkRows,
  cleanRow,
  guessMapping,
  IMPORT_FIELDS,
  type Mapping,
  mapRows,
  MAX_ROWS,
  prepareRows,
  type RawRow,
  REJECT_LABEL,
  type RejectCode,
  STRATEGIES,
  STRATEGY_LABEL,
  type Strategy,
} from "@/lib/import";
import { finishImport, findExistingPhones, importChunk, startImport } from "./import-actions";

type Step = "upload" | "map" | "review" | "importing" | "done";
type Totals = { created: number[]; skipped: number[]; invalid: number[] };
const NONE = "none";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ImportWizard({ campaignId, campaignName, callers }: { campaignId: string; campaignName: string; callers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [oneCaller, setOneCaller] = useState<string>();
  const [defaultTags, setDefaultTags] = useState("");
  const [defaultSource, setDefaultSource] = useState("");
  const [job, setJob] = useState<{ key: string; chunks: RawRow[][]; done: Set<number>; totals: Totals; error?: string }>();

  const preview = useMemo(() => prepareRows(mapRows(data, mapping), existing), [data, mapping, existing]);
  const running = step === "importing" && !job?.error;

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function reset() {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setData([]);
    setMapping({});
    setExisting(new Set());
    setJob(undefined);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: ({ data: rows, errors }) => {
        const [head, ...body] = rows;
        if (!head || !body.length) return void toast.error("That file has no rows under the header.");
        if (errors.some((e) => e.type === "Quotes")) toast.warning("Some quotes in the file look broken; check the preview.");
        if (body.length > MAX_ROWS) return void toast.error(`Files are limited to ${MAX_ROWS.toLocaleString()} rows. Split it and import in parts.`);
        const cleanHead = head.map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h).trim() || `Column ${i + 1}`);
        setFileName(file.name);
        setHeaders(cleanHead);
        setData(body);
        setMapping(guessMapping(cleanHead));
        setStep("map");
      },
      error: () => toast.error("Couldn't read that file. Save it as CSV (UTF-8) and try again."),
    });
  }

  async function toReview() {
    setBusy(true);
    try {
      const phones = [...new Set(mapRows(data, mapping).flatMap((r) => {
        const c = cleanRow(r);
        return c.ok ? [c.value.phone] : [];
      }))];
      const found = new Set<string>();
      for (let i = 0; i < phones.length; i += 5000) {
        const res = await findExistingPhones({ campaignId, phones: phones.slice(i, i + 5000) });
        if (!res.ok) throw new Error(res.error);
        res.phones.forEach((p) => found.add(p));
      }
      setExisting(found);
      setStep("review");
    } catch {
      toast.error("Couldn't check for existing contacts. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport(current = job) {
    const j = current ?? { key: crypto.randomUUID(), chunks: chunkRows(preview.ok), done: new Set<number>(), totals: { created: [], skipped: [], invalid: [] } };
    setJob({ ...j, error: undefined });
    setStep("importing");
    try {
      const rejectedInBrowser = Object.fromEntries(
        Object.keys(REJECT_LABEL).map((code) => [code, preview.rejected.filter((r) => r.code === code).length]),
      );
      const started = await startImport({
        key: j.key,
        campaignId,
        fileName,
        mapping: Object.fromEntries(Object.entries(mapping).map(([f, col]) => [f, headers[col as number]])),
        strategy,
        oneCallerId: strategy === "one" ? oneCaller : undefined,
        defaultTags,
        defaultSource,
        totalRows: data.length,
        rejectedInBrowser,
      });
      if (!started.ok) throw new Error(started.error);

      for (let index = 0; index < j.chunks.length; index++) {
        if (j.done.has(index)) continue;
        let res: Awaited<ReturnType<typeof importChunk>> | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            res = await importChunk({ key: j.key, index, rows: j.chunks[index] });
            break;
          } catch {
            await sleep(1000 * 2 ** attempt); // network blip: retry the same chunk; the server won't double-import it
          }
        }
        if (!res) throw new Error("Lost connection to the server.");
        if (!res.ok) throw new Error(res.error);
        j.done.add(index);
        j.totals.created.push(...res.created);
        j.totals.skipped.push(...res.skipped);
        j.totals.invalid.push(...res.invalid);
        setJob({ ...j, done: new Set(j.done) });
      }
      const fin = await finishImport(j.key);
      if (!fin.ok) throw new Error(fin.error);
      setStep("done");
    } catch (e) {
      setJob({ ...j, error: e instanceof Error ? e.message : "Import stopped." });
    }
  }

  function downloadRejected() {
    const reason = new Map<number, string>(preview.rejected.map((r) => [r.row.row, REJECT_LABEL[r.code]]));
    job?.totals.skipped.forEach((n) => reason.set(n, REJECT_LABEL.already_in_campaign));
    job?.totals.invalid.forEach((n) => reason.set(n, "Rejected by server"));
    const rows = [...reason.entries()].sort((a, b) => a[0] - b[0]).map(([row, why]) => ({ row, why, cells: data[row - 2] ?? [] }));
    const csv = toCsv(rows, [
      { header: "Row", value: (r) => r.row },
      { header: "Reason", value: (r) => r.why },
      ...headers.map((h, i) => ({ header: h, value: (r: (typeof rows)[number]) => r.cells[i] ?? "" })),
    ]);
    download(csv, `${fileName.replace(/\.csv$/i, "")}-rejected.csv`, CSV_TYPE);
  }

  const counts = preview.rejected.reduce<Partial<Record<RejectCode, number>>>((m, r) => ({ ...m, [r.code]: (m[r.code] ?? 0) + 1 }), {});
  const progress = job ? Math.round((job.done.size / Math.max(1, job.chunks.length)) * 100) : 0;
  const canImport = preview.ok.length > 0 && !(strategy === "one" && !oneCaller);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && running) return void toast.warning("Please wait until the import finishes.");
        setOpen(o);
        if (!o && step === "done") reset();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline">
          <Upload aria-hidden /> Import CSV
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Import contacts</SheetTitle>
          <SheetDescription>
            Into <strong>{campaignName}</strong>. {fileName && `File: ${fileName} (${data.length} rows)`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {step === "upload" && (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/50">
              <FileUp className="size-8 text-muted-foreground" aria-hidden />
              <span className="font-medium">Choose a CSV file</span>
              <span className="text-muted-foreground">UTF-8, first row is the header. Name and phone columns are required.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          )}

          {step === "map" && (
            <FieldGroup>
              <FieldDescription>Match each field to a column in your file. We guessed where we could.</FieldDescription>
              {IMPORT_FIELDS.map((f) => {
                const col = mapping[f.key];
                return (
                  <Field key={f.key} orientation="responsive">
                    <FieldLabel htmlFor={`map-${f.key}`}>
                      {f.label}
                      {"required" in f && " *"}
                    </FieldLabel>
                    <div className="grid gap-1 sm:w-72">
                      <Select
                        value={col === undefined ? NONE : String(col)}
                        onValueChange={(v) => setMapping((m) => {
                          const next = { ...m };
                          if (v === NONE) delete next[f.key];
                          else next[f.key] = Number(v);
                          return next;
                        })}
                      >
                        <SelectTrigger id={`map-${f.key}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— Not in file —</SelectItem>
                          {headers.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {col !== undefined && (
                        <span className="truncate text-xs text-muted-foreground">e.g. {data[0]?.[col] || "(blank)"}</span>
                      )}
                    </div>
                  </Field>
                );
              })}
            </FieldGroup>
          )}

          {step === "review" && (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge className="border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                  {preview.ok.length} new
                </Badge>
                {(Object.keys(REJECT_LABEL) as RejectCode[]).map(
                  (code) =>
                    counts[code] && (
                      <Badge key={code} variant="outline">
                        {counts[code]} {REJECT_LABEL[code].toLowerCase()}
                      </Badge>
                    ),
                )}
              </div>
              <PreviewTable data={data} mapping={mapping} preview={preview} />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="imp-strategy">Assign new contacts</FieldLabel>
                  <Select value={strategy} onValueChange={(v) => setStrategy(v as Strategy)}>
                    <SelectTrigger id="imp-strategy" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STRATEGY_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!callers.length && strategy !== "none" && (
                    <FieldDescription>This campaign has no callers yet, so contacts will be left unassigned.</FieldDescription>
                  )}
                </Field>
                {strategy === "one" && (
                  <Field>
                    <FieldLabel htmlFor="imp-one">Caller</FieldLabel>
                    <Select value={oneCaller} onValueChange={setOneCaller}>
                      <SelectTrigger id="imp-one" className="w-full">
                        <SelectValue placeholder="Choose a caller" />
                      </SelectTrigger>
                      <SelectContent>
                        {callers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="imp-source">Source (when the file has none)</FieldLabel>
                    <Input id="imp-source" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} placeholder="e.g. Seminar" maxLength={80} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="imp-tags">Add tags to every contact</FieldLabel>
                    <Input id="imp-tags" value={defaultTags} onChange={(e) => setDefaultTags(e.target.value)} placeholder="Comma separated" maxLength={500} />
                  </Field>
                </div>
              </FieldGroup>
            </>
          )}

          {step === "importing" && job && (
            <div className="space-y-3" aria-live="polite">
              <Progress value={progress} aria-label="Import progress" />
              <p className="text-sm">
                {job.error ? (
                  <span className="text-destructive">
                    Import paused: {job.error} Nothing is imported twice — resume when you&apos;re back online.
                  </span>
                ) : (
                  `Importing… ${job.totals.created.length + job.totals.skipped.length + job.totals.invalid.length} of ${preview.ok.length} rows. Keep this tab open.`
                )}
              </p>
            </div>
          )}

          {step === "done" && job && (
            <div className="space-y-3" aria-live="polite">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Import finished
              </p>
              <dl className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Added</dt>
                  <dd className="text-lg font-semibold">{job.totals.created.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Already there</dt>
                  <dd className="text-lg font-semibold">{job.totals.skipped.length + (counts.already_in_campaign ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Rejected</dt>
                  <dd className="text-lg font-semibold">
                    {job.totals.invalid.length + preview.rejected.length - (counts.already_in_campaign ?? 0)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row flex-wrap justify-end">
          {step === "map" && (
            <>
              <Button variant="outline" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={toReview} disabled={busy || mapping.name === undefined || mapping.phone === undefined}>
                {busy ? "Checking…" : "Continue"}
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("map")}>
                Back
              </Button>
              {preview.rejected.length > 0 && (
                <Button variant="outline" onClick={downloadRejected}>
                  <Download aria-hidden /> Rejected rows
                </Button>
              )}
              <Button onClick={() => runImport()} disabled={!canImport}>
                Import {preview.ok.length} contacts
              </Button>
            </>
          )}
          {step === "importing" && job?.error && (
            <Button onClick={() => runImport(job)}>
              <RotateCcw aria-hidden /> Resume import
            </Button>
          )}
          {step === "done" && (
            <>
              {(preview.rejected.length > 0 || !!job?.totals.skipped.length || !!job?.totals.invalid.length) && (
                <Button variant="outline" onClick={downloadRejected}>
                  <Download aria-hidden /> Download rejected rows
                </Button>
              )}
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PreviewTable({ data, mapping, preview }: { data: string[][]; mapping: Mapping; preview: ReturnType<typeof prepareRows> }) {
  const status = new Map<number, RejectCode>(preview.rejected.map((r) => [r.row.row, r.code]));
  // Problems first, so they're easy to spot; then the first new rows.
  const rows = [...preview.rejected.map((r) => r.row), ...preview.ok].slice(0, 100);
  const get = (r: RawRow, col: number | undefined) => (col === undefined ? "" : (data[r.row - 2]?.[col] ?? ""));
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Row</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const code = status.get(r.row);
            const clean = cleanRow(r);
            return (
              <TableRow key={r.row}>
                <TableCell className="text-muted-foreground">{r.row}</TableCell>
                <TableCell className="max-w-40 truncate">{get(r, mapping.name) || <span className="text-muted-foreground">(blank)</span>}</TableCell>
                <TableCell className="tabular-nums">{clean.ok ? clean.value.phone : get(r, mapping.phone)}</TableCell>
                <TableCell>
                  {code ? (
                    <Badge variant={code === "already_in_campaign" || code === "duplicate_in_file" ? "outline" : "destructive"}>{REJECT_LABEL[code]}</Badge>
                  ) : (
                    <Badge className="border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">New</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {preview.ok.length + preview.rejected.length > 100 && (
        <p className="p-2 text-center text-xs text-muted-foreground">Showing the first 100 rows.</p>
      )}
    </div>
  );
}
