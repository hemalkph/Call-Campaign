"use client";

import { type ColumnDef, flexRender, getCoreRowModel, type RowSelectionState, useReactTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Filter, Plus, Search, Tag, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { StageBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ListParams } from "@/lib/contacts-query";
import type { Role } from "@/lib/schemas";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, OUTCOMES, STAGE_META, STAGES, type Stage } from "@/lib/vocab";
import { bulkUpdateContacts } from "./actions";
import { type ContactRow, ContactSheet } from "./contact-sheet";
import { ExportMenu } from "./export-menu";
import { ImportWizard } from "./import-wizard";

type Props = {
  role: Role;
  campaigns: { id: string; name: string }[];
  campaignId: string;
  params: ListParams;
  rows: ContactRow[];
  total: number;
  pageSize: number;
  options: { tags: string[]; districts: string[] };
  callers: { id: string; name: string }[];
  userNames: Record<string, string>;
};

const ALL = "all";
const DEFAULTS: Partial<Record<keyof ListParams, string>> = { sort: "createdAt", dir: "desc", page: "1" };
const FILTER_KEYS = ["stage", "caller", "outcome", "tag", "district", "source", "callback", "notCalled"] as const;

export function ContactsView(props: Props) {
  const { role, campaigns, campaignId, params, rows, total, pageSize, options, callers, userNames } = props;
  const isOwner = role === "owner";
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [selection, setSelection] = useState<RowSelectionState>({});

  /** Filters, sort and page live in the URL so views can be shared, bookmarked and exported. */
  function setParams(patch: Partial<Record<keyof ListParams, string | undefined>>, keepPage = false) {
    const next: Record<string, unknown> = { ...params, ...(keepPage ? {} : { page: undefined }), ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || String(v) === DEFAULTS[k as keyof ListParams]) continue;
      sp.set(k, String(v));
    }
    setSelection({});
    startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
  }

  const [q, setQ] = useState(params.q ?? "");
  useEffect(() => {
    if (q === (params.q ?? "")) return;
    const t = setTimeout(() => setParams({ q: q || undefined }), 350);
    return () => clearTimeout(t);
  });

  function sortBy(key: ListParams["sort"]) {
    setParams({ sort: key, dir: params.sort === key && params.dir === "asc" ? "desc" : "asc" });
  }

  const columns = useMemo<ColumnDef<ContactRow>[]>(() => {
    const sortHeader = (key: ListParams["sort"], label: string) => {
      const active = params.sort === key;
      const Icon = !active ? ArrowUpDown : params.dir === "asc" ? ArrowUp : ArrowDown;
      return (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => sortBy(key)}>
          {label} <Icon aria-hidden className={cn(!active && "opacity-40")} />
        </Button>
      );
    };
    const cols: ColumnDef<ContactRow>[] = [
      {
        id: "name",
        header: () => sortHeader("name", "Name"),
        cell: ({ row: { original: c } }) => (
          <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpenId(c.id)}>
            {c.name}
            <span className="block text-xs font-normal text-muted-foreground">
              <span className="tabular-nums sm:hidden">{c.phone} · </span>
              {[c.school, c.gradeOrBatch].filter(Boolean).join(" · ")}
            </span>
          </button>
        ),
      },
      {
        id: "phone",
        header: "Phone",
        meta: { className: "hidden sm:table-cell" },
        cell: ({ row: { original: c } }) => (
          <a href={`tel:${c.phone}`} className="tabular-nums hover:underline" onClick={(e) => e.stopPropagation()}>
            {c.phone}
          </a>
        ),
      },
      { id: "stage", header: () => sortHeader("stage", "Stage"), cell: ({ row }) => <StageBadge stage={row.original.stage} /> },
      {
        id: "lastCallAt",
        header: () => sortHeader("lastCallAt", "Last call"),
        meta: { className: "hidden md:table-cell" },
        cell: ({ row: { original: c } }) =>
          c.lastCallAt ? (
            <span title={fmtDateTime(c.lastCallAt)}>
              {c.lastOutcome ? OUTCOME_LABEL[c.lastOutcome] : "Called"}
              <span className="block text-xs text-muted-foreground">{fmtDate(c.lastCallAt)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Not called</span>
          ),
      },
      {
        id: "nextCallbackAt",
        header: () => sortHeader("nextCallbackAt", "Callback"),
        meta: { className: "hidden lg:table-cell" },
        cell: ({ row: { original: c } }) =>
          c.nextCallbackAt ? (
            <span suppressHydrationWarning className={cn(new Date(c.nextCallbackAt) < new Date() && "font-medium text-destructive")}>
              {fmtDateTime(c.nextCallbackAt)}
            </span>
          ) : null,
      },
    ];
    if (isOwner) {
      cols.unshift({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      });
      cols.splice(4, 0, {
        id: "caller",
        header: "Caller",
        meta: { className: "hidden sm:table-cell" },
        cell: ({ row: { original: c } }) =>
          c.assignedTo ? userNames[c.assignedTo] ?? "Unknown" : <span className="text-muted-foreground">Unassigned</span>,
      });
    }
    return cols;
  }, [isOwner, params.sort, params.dir, userNames]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = FILTER_KEYS.filter((k) => params[k]).length;
  const openContact = rows.find((r) => r.id === openId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {campaigns.length > 1 && (
          <Select value={campaignId} onValueChange={(v) => setParams({ campaign: v, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) })}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Campaign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search name, school or phone"
            placeholder="Search name, school or phone"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Filters params={params} setParams={setParams} isOwner={isOwner} callers={callers} options={options} active={activeFilters} />
        {isOwner && (
          <>
            <ImportWizard campaignId={campaignId} campaignName={campaigns.find((c) => c.id === campaignId)?.name ?? ""} callers={callers} />
            <ExportMenu campaignId={campaignId} params={params} />
          </>
        )}
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden /> Add contact
        </Button>
      </div>

      {isOwner && selectedIds.length > 0 && (
        <BulkBar ids={selectedIds} callers={callers} onDone={() => setSelection({})} />
      )}

      <div className={cn("rounded-lg border transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className={(h.column.columnDef.meta as { className?: string })?.className}
                    aria-sort={params.sort === h.id ? (params.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => setOpenId(row.original.id)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn("whitespace-normal", (cell.column.columnDef.meta as { className?: string })?.className)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  {q || activeFilters ? "No contacts match these filters." : "No contacts yet. Add one, or import a CSV."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {total ? `${(params.page - 1) * pageSize + 1}–${Math.min(params.page * pageSize, total)} of ${total}` : "0 contacts"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" disabled={params.page <= 1} onClick={() => setParams({ page: String(params.page - 1) }, true)}>
            <ChevronLeft aria-hidden />
            <span className="sr-only">Previous page</span>
          </Button>
          <span className="px-2">
            Page {params.page} of {pages}
          </span>
          <Button variant="outline" size="icon" disabled={params.page >= pages} onClick={() => setParams({ page: String(params.page + 1) }, true)}>
            <ChevronRight aria-hidden />
            <span className="sr-only">Next page</span>
          </Button>
        </div>
      </div>

      {openContact && (
        <ContactSheet
          key={openContact.id}
          open
          onOpenChange={(o) => !o && setOpenId(undefined)}
          contact={openContact}
          campaignId={campaignId}
          isOwner={isOwner}
          callers={callers}
        />
      )}
      <ContactSheet key={campaignId} open={adding} onOpenChange={setAdding} campaignId={campaignId} isOwner={isOwner} callers={callers} />
    </div>
  );
}

function Filters({
  params,
  setParams,
  isOwner,
  callers,
  options,
  active,
}: {
  params: ListParams;
  setParams: (p: Partial<Record<keyof ListParams, string | undefined>>) => void;
  isOwner: boolean;
  callers: { id: string; name: string }[];
  options: { tags: string[]; districts: string[] };
  active: number;
}) {
  const pick = (key: keyof ListParams, label: string, items: { value: string; label: string }[]) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`f-${key}`}>{label}</Label>
      <Select value={(params[key] as string | undefined) ?? ALL} onValueChange={(v) => setParams({ [key]: v === ALL ? undefined : v })}>
        <SelectTrigger id={`f-${key}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const toggle = (key: "callback" | "notCalled", label: string) => (
    <div className="flex items-center gap-2">
      <Checkbox id={`f-${key}`} checked={!!params[key]} onCheckedChange={(v) => setParams({ [key]: v ? "yes" : undefined })} />
      <Label htmlFor={`f-${key}`}>{label}</Label>
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Filter aria-hidden /> Filters{active ? ` (${active})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3">
        {pick("stage", "Stage", STAGES.map((s) => ({ value: s, label: STAGE_META[s].label })))}
        {isOwner &&
          pick("caller", "Caller", [{ value: "none", label: "Unassigned" }, ...callers.map((c) => ({ value: c.id, label: c.name }))])}
        {pick("outcome", "Last outcome", OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] })))}
        {options.tags.length > 0 && pick("tag", "Tag", options.tags.map((t) => ({ value: t, label: t })))}
        {options.districts.length > 0 && pick("district", "District", options.districts.map((d) => ({ value: d, label: d })))}
        {toggle("callback", "Has a callback")}
        {toggle("notCalled", "Not called yet")}
        {active > 0 && (
          <Button variant="ghost" onClick={() => setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}>
            <X aria-hidden /> Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function BulkBar({ ids, callers, onDone }: { ids: string[]; callers: { id: string; name: string }[]; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [confirmEnrol, setConfirmEnrol] = useState(false);
  const [tag, setTag] = useState("");

  async function run(input: Parameters<typeof bulkUpdateContacts>[0]) {
    setPending(true);
    try {
      const res = await bulkUpdateContacts(input);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Updated ${res.changed} ${res.changed === 1 ? "contact" : "contacts"}`);
      setTag("");
      onDone();
    } catch {
      toast.error("Couldn't reach the server. Nothing was changed — try again.");
    } finally {
      setPending(false);
    }
  }

  const stage = (s: Stage) => (s === "enrolled" ? setConfirmEnrol(true) : run({ action: "stage", ids, stage: s }));

  return (
    <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm">
      <span className="px-1 font-medium">{ids.length} selected</span>
      <Select disabled={pending} value="" onValueChange={(v) => run({ action: "reassign", ids, assignedTo: v === "none" ? "" : v })}>
        <SelectTrigger className="w-40" aria-label="Reassign selected">
          <SelectValue placeholder="Reassign to…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {callers.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select disabled={pending} value="" onValueChange={(v) => stage(v as Stage)}>
        <SelectTrigger className="w-44" aria-label="Change stage of selected">
          <SelectValue placeholder="Change stage…" />
        </SelectTrigger>
        <SelectContent>
          {STAGES.map((s) => (
            <SelectItem key={s} value={s}>
              {STAGE_META[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) run({ action: "addTag", ids, tag: tag.trim() });
        }}
      >
        <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag" aria-label="Tag to add" className="w-28" maxLength={40} />
        <Button type="submit" variant="outline" disabled={pending || !tag.trim()}>
          <Tag aria-hidden /> Add tag
        </Button>
      </form>
      <Button variant="ghost" onClick={onDone} className="ml-auto">
        Clear selection
      </Button>

      <AlertDialog open={confirmEnrol} onOpenChange={setConfirmEnrol}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {ids.length} contacts as enrolled?</AlertDialogTitle>
            <AlertDialogDescription>Only do this once their payments have been received.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run({ action: "stage", ids, stage: "enrolled" })}>Yes, enrolled</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
