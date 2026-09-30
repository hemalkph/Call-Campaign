import { and, count, desc, asc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { callbacks, campaigns, contacts, db, users } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { dayBounds } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CallbackList } from "./callback-list";

export const metadata = { title: "Callbacks" };

const TABS = ["overdue", "today", "upcoming", "done"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", done: "Done" };
const caller = alias(users, "caller");

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser();
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t === requested) ?? "overdue";
  const now = new Date();
  const { end } = dayBounds(now);
  const scope = me.role === "owner" ? undefined : eq(callbacks.callerId, me.id);
  const pending = eq(callbacks.status, "pending");
  const filters: Record<Tab, SQL | undefined> = {
    overdue: and(pending, lt(callbacks.dueAt, now)),
    today: and(pending, gte(callbacks.dueAt, now), lt(callbacks.dueAt, end)),
    upcoming: and(pending, gte(callbacks.dueAt, end)),
    done: inArray(callbacks.status, ["done", "cancelled"]),
  };

  const [counts, items] = await Promise.all([
    Promise.all(
      TABS.map(async (t) =>
        t === "done" ? null : (await db.select({ n: count() }).from(callbacks).where(and(scope, filters[t])))[0].n,
      ),
    ),
    db
      .select({ cb: callbacks, contactName: contacts.name, phone: contacts.phone, campaignName: campaigns.name, callerName: caller.name })
      .from(callbacks)
      .innerJoin(contacts, eq(contacts.id, callbacks.contactId))
      .innerJoin(campaigns, eq(campaigns.id, callbacks.campaignId))
      .leftJoin(caller, eq(caller.id, callbacks.callerId))
      .where(and(scope, filters[tab]))
      .orderBy(tab === "done" ? desc(callbacks.updatedAt) : asc(callbacks.dueAt))
      .limit(100),
  ]);

  return (
    <>
      <PageHeader title="Callbacks" description={me.role === "owner" ? "Everyone's callbacks." : "Calls you promised to make."} />
      <nav aria-label="Callback lists" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {TABS.map((t, i) => (
          <Link
            key={t}
            href={`/callbacks?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm whitespace-nowrap",
              t === tab ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[t]}
            {counts[i] !== null && <span className={cn("ml-1", t === "overdue" && counts[i] ? "text-destructive" : "")}>({counts[i]})</span>}
          </Link>
        ))}
      </nav>
      <CallbackList
        tab={tab}
        items={items.map(({ cb, contactName, phone, campaignName, callerName }) => ({
          id: cb.id,
          contactId: cb.contactId,
          campaignId: cb.campaignId,
          contactName,
          phone,
          campaignName,
          callerName: me.role === "owner" ? (callerName ?? "Unassigned") : undefined,
          dueAt: cb.dueAt.toISOString(),
          note: cb.note,
          status: cb.status,
          reason: cb.history.findLast((h) => h.action === "cancelled")?.reason ?? "",
        }))}
      />
    </>
  );
}
