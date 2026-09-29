import { Types } from "mongoose";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Campaign } from "@/lib/models/campaign";
import { Callback } from "@/lib/models/callback";
import { Contact } from "@/lib/models/contact";
import { User } from "@/lib/models/user";
import { requireUser } from "@/lib/session";
import { dayBounds } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CallbackList } from "./callback-list";

export const metadata = { title: "Callbacks" };

const TABS = ["overdue", "today", "upcoming", "done"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", done: "Done" };

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser();
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t === requested) ?? "overdue";
  const now = new Date();
  const { end } = dayBounds(now);
  const scope = me.role === "owner" ? {} : { callerId: new Types.ObjectId(me.id) };
  const filters: Record<Tab, object> = {
    overdue: { status: "pending", dueAt: { $lt: now } },
    today: { status: "pending", dueAt: { $gte: now, $lt: end } },
    upcoming: { status: "pending", dueAt: { $gte: end } },
    done: { status: { $in: ["done", "cancelled"] } },
  };

  const [counts, items] = await Promise.all([
    Promise.all(TABS.map((t) => (t === "done" ? Promise.resolve(null) : Callback.countDocuments({ ...scope, ...filters[t] })))),
    Callback.find({ ...scope, ...filters[tab] })
      .sort(tab === "done" ? { updatedAt: -1 } : { dueAt: 1 })
      .limit(100)
      .lean(),
  ]);
  const [contacts, campaigns, users] = await Promise.all([
    Contact.find({ _id: { $in: items.map((i) => i.contactId) } }, { name: 1, phone: 1 }).lean(),
    Campaign.find({ _id: { $in: items.map((i) => i.campaignId) } }, { name: 1 }).lean(),
    me.role === "owner" ? User.find({ _id: { $in: items.map((i) => i.callerId) } }, { name: 1 }).lean() : Promise.resolve([]),
  ]);
  const find = <T extends { _id: unknown }>(list: T[], id: unknown) => list.find((x) => String(x._id) === String(id));

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
        items={items.map((cb) => ({
          id: String(cb._id),
          contactId: String(cb.contactId),
          campaignId: String(cb.campaignId),
          contactName: find(contacts, cb.contactId)?.name ?? "Deleted contact",
          phone: find(contacts, cb.contactId)?.phone ?? "",
          campaignName: find(campaigns, cb.campaignId)?.name ?? "",
          callerName: me.role === "owner" ? (find(users, cb.callerId)?.name ?? "Unassigned") : undefined,
          dueAt: cb.dueAt.toISOString(),
          note: cb.note,
          status: cb.status,
          reason: cb.history.findLast((h) => h.action === "cancelled")?.reason ?? "",
        }))}
      />
    </>
  );
}
