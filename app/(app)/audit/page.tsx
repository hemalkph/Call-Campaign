import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { count, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, campaigns, contacts, db, users as usersTable } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { STAGE_META, type Stage } from "@/lib/vocab";
import { ActionFilter } from "./action-filter";

export const metadata = { title: "Audit log" };

const PAGE = 50;
const ACTION_LABEL: Record<string, string> = {
  "user.create": "User created",
  "user.activate": "User reactivated",
  "user.deactivate": "User deactivated",
  "user.reset_password": "Password reset",
  "user.change_password": "Password changed",
  "campaign.create": "Campaign created",
  "campaign.update": "Campaign edited",
  "campaign.duplicate": "Campaign duplicated",
  "contact.stage": "Stage changed",
  "contact.reassign": "Contact reassigned",
  "contact.bulk_stage": "Bulk stage change",
  "contact.bulk_reassign": "Bulk reassignment",
  "import.start": "Import started",
  "import.finish": "Import finished",
  "call.undo": "Call undone",
  "template.create": "Template created",
  "template.update": "Template edited",
  "template.delete": "Template deleted",
};
const label = (a: string) => ACTION_LABEL[a] ?? (a.startsWith("export.") ? `Export (${a.slice(7)})` : a);

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const actions = (await db.selectDistinct({ action: auditEvents.action }).from(auditEvents)).map((a) => a.action).sort();
  const action = actions.includes(sp.action ?? "") ? sp.action : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const filter = action ? eq(auditEvents.action, action) : undefined;

  const [events, [{ total }]] = await Promise.all([
    db.select().from(auditEvents).where(filter).orderBy(desc(auditEvents.at)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(auditEvents).where(filter),
  ]);
  const ids = (entity: string) => events.filter((e) => e.entity === entity && e.entityId).map((e) => e.entityId!);
  const byId = async (table: typeof usersTable | typeof contacts | typeof campaigns, list: string[]) =>
    list.length ? db.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, list)) : [];
  const [users, contactNames, campaignNames] = await Promise.all([
    byId(usersTable, [...events.flatMap((e) => (e.actorId ? [e.actorId] : [])), ...ids("users")]),
    byId(contacts, ids("contacts")),
    byId(campaigns, ids("campaigns")),
  ]);
  const nameOf = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name;
  const subject = (e: (typeof events)[number]) =>
    (e.entity === "users" && nameOf(users, e.entityId)) ||
    (e.entity === "contacts" && nameOf(contactNames, e.entityId)) ||
    (e.entity === "campaigns" && nameOf(campaignNames, e.entityId)) ||
    e.entity;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number) => `/audit?${new URLSearchParams({ ...(action ? { action } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Who changed what. Phone numbers and passwords are never recorded here.">
        <ActionFilter actions={actions.map((a) => ({ value: a, label: label(a) }))} value={action} />
      </PageHeader>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead className="hidden sm:table-cell">Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="w-28 whitespace-normal sm:w-auto sm:whitespace-nowrap">{fmtDateTime(e.at)}</TableCell>
                <TableCell className="hidden sm:table-cell">{e.actorId ? (nameOf(users, e.actorId) ?? "Deleted user") : "System"}</TableCell>
                <TableCell className="whitespace-normal break-words">
                  <span className="font-medium">{label(e.action)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {subject(e)}
                    <span className="sm:hidden"> · by {e.actorId ? (nameOf(users, e.actorId) ?? "Deleted user") : "System"}</span>
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-md text-xs whitespace-normal text-muted-foreground md:table-cell">
                  <Details before={e.before} after={e.after} users={users} />
                </TableCell>
              </TableRow>
            ))}
            {!events.length && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No events.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} events</span>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "pointer-events-none opacity-50")}>
            <Link href={href(page - 1)} aria-disabled={page <= 1}>
              Newer
            </Link>
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" className={cn(page >= pages && "pointer-events-none opacity-50")}>
            <Link href={href(page + 1)} aria-disabled={page >= pages}>
              Older
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}

/** A compact, readable before → after. Stage codes and user ids are turned into names. */
function Details({ before, after, users }: { before: unknown; after: unknown; users: { id: string; name: string }[] }) {
  const show = (v: unknown): string => {
    if (v === null || v === undefined) return "none";
    if (typeof v === "string") return STAGE_META[v as Stage]?.label ?? users.find((u) => u.id === v)?.name ?? v;
    if (Array.isArray(v)) return v.map(show).join(", ");
    if (typeof v === "object") {
      // jsonb stores keys shortest-first; show the main change first and "how" (via / callId) last.
      const last = (k: string) => (k === "via" || k === "callId" ? 1 : 0);
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => last(a) - last(b));
      if (entries.length > 5) return `${entries.length} items`;
      return entries.map(([k, x]) => `${k}: ${show(x)}`).join("; ");
    }
    return String(v);
  };
  if (!before && !after) return null;
  return (
    <>
      {before !== undefined && before !== null && <span>{show(before)} → </span>}
      {after !== undefined && after !== null && <span className="text-foreground">{show(after)}</span>}
    </>
  );
}
