import { AlarmClock, PhoneCall } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { REACHED_OUTCOMES } from "@/lib/calling";
import { activeCampaignsFor } from "@/lib/contacts-query";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { callbacks, calls, contacts, db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { dayBounds, fmtDateTime, fmtTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const me = await requireUser();
  const campaigns = await activeCampaignsFor(me);
  const now = new Date();
  const { start, end } = dayBounds(now);
  const campaignIds = campaigns.map((c) => c.id);
  const mine = and(eq(calls.callerId, me.id), gte(calls.calledAt, start));

  const [callsByCampaign, [{ answered }], dueCallbacks] = await Promise.all([
    db.select({ campaignId: calls.campaignId, n: sql<number>`count(*)::int` }).from(calls).where(mine).groupBy(calls.campaignId),
    db.select({ answered: sql<number>`count(*)::int` }).from(calls).where(and(mine, inArray(calls.outcome, REACHED_OUTCOMES))),
    campaignIds.length
      ? db
          .select({ cb: callbacks, name: contacts.name })
          .from(callbacks)
          .innerJoin(contacts, eq(contacts.id, callbacks.contactId))
          .where(and(eq(callbacks.callerId, me.id), eq(callbacks.status, "pending"), inArray(callbacks.campaignId, campaignIds), lt(callbacks.dueAt, end)))
          .orderBy(asc(callbacks.dueAt))
          .limit(50)
      : [],
  ]);
  const calls_ = (id: string) => callsByCampaign.find((c) => c.campaignId === id)?.n ?? 0;
  const totalCalls = callsByCampaign.reduce((n, c) => n + c.n, 0);
  const overdue = dueCallbacks.filter(({ cb }) => cb.dueAt < now);
  const later = dueCallbacks.filter(({ cb }) => cb.dueAt >= now);

  return (
    <>
      <PageHeader title={`Hi, ${me.name}`} description="Your calls and callbacks for today.">
        {campaigns.length > 0 && (
          <Button asChild size="lg">
            <Link href="/calling">
              <PhoneCall aria-hidden /> Start calling
            </Link>
          </Button>
        )}
      </PageHeader>

      {!campaigns.length ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          You&apos;re not on an active campaign yet. Ask the owner to add you.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <CardDescription>Calls today</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-semibold tabular-nums">
                  {calls_(c.id)}
                  {c.target > 0 && <span className="text-lg font-normal text-muted-foreground"> / {c.target}</span>}
                </p>
                {c.target > 0 && <Progress value={Math.min(100, (calls_(c.id) / c.target) * 100)} aria-label={`Calls today for ${c.name} against target`} />}
                {campaigns.length > 1 && (
                  <Button asChild variant="link" className="px-0">
                    <Link href={`/calling?campaign=${c.id}`}>Call for this campaign</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle>Reached today</CardTitle>
              <CardDescription>Calls where someone answered</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {answered}
                {totalCalls > 0 && <span className="text-lg font-normal text-muted-foreground"> of {totalCalls}</span>}
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlarmClock className="size-5" aria-hidden /> Callbacks due today
              </CardTitle>
              <CardDescription>
                {overdue.length ? `${overdue.length} overdue · ` : ""}
                {later.length} still to come today
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!dueCallbacks.length ? (
                <p className="text-sm text-muted-foreground">No callbacks due today.</p>
              ) : (
                <ul className="divide-y">
                  {dueCallbacks.map(({ cb, name }) => {
                    const late = cb.dueAt < now;
                    return (
                      <li key={cb.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{name}</p>
                          <p className={cn("text-sm", late ? "font-medium text-destructive" : "text-muted-foreground")}>
                            {late ? `Overdue · ${fmtDateTime(cb.dueAt)}` : fmtTime(cb.dueAt)}
                            {cb.note && ` · ${cb.note}`}
                          </p>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/calling?campaign=${cb.campaignId}&contact=${cb.contactId}`}>Call now</Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
