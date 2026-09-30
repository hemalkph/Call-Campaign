import { AlarmClock, GraduationCap, PhoneCall, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { CampaignPicker } from "@/components/campaign-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { visibleCampaigns } from "@/lib/contacts-query";
import { eq } from "drizzle-orm";
import { campaigns as campaignsTable, db } from "@/lib/db";
import { callerPerformance, dailyCalls, stageCounts, topSources } from "@/lib/reports";
import { requireOwner } from "@/lib/session";
import { STAGE_META, type Stage } from "@/lib/vocab";
import { DailyChart } from "./daily-chart";

export const metadata = { title: "Dashboard" };

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const FUNNEL: Stage[] = ["new", "contacted", "interested", "payment_details_sent", "enrolled"];
const CLOSED: Stage[] = ["not_interested", "wrong_number", "do_not_contact"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const me = await requireOwner();
  const campaigns = await visibleCampaigns(me);
  if (!campaigns.length)
    return (
      <>
        <PageHeader title={`Welcome, ${me.name}`} />
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p className="mb-3">No campaigns yet.</p>
          <Button asChild>
            <Link href="/campaigns">Create a campaign</Link>
          </Button>
        </div>
      </>
    );

  const requested = (await searchParams).campaign;
  const campaign = campaigns.find((c) => c.id === requested) ?? campaigns[0];
  const [[details], callers, stages, sources, daily] = await Promise.all([
    db.select({ enrollmentTarget: campaignsTable.enrollmentTarget }).from(campaignsTable).where(eq(campaignsTable.id, campaign.id)),
    callerPerformance(campaign.id),
    stageCounts(campaign.id),
    topSources(campaign.id),
    dailyCalls(campaign.id),
  ]);
  const list = (q: Record<string, string>) => `/contacts?${new URLSearchParams({ campaign: campaign.id, ...q })}`;
  const sum = (k: "callsToday" | "reachedToday" | "target" | "overdueCallbacks") => callers.reduce((n, c) => n + c[k], 0);
  const total = Object.values(stages).reduce((a, b) => a + b, 0);
  // Funnel rows count contacts that reached *at least* that stage.
  // Every contact started as "new", including the ones that are now closed.
  const funnel = FUNNEL.map((s, i) => ({ stage: s, atLeast: i === 0 ? total : FUNNEL.slice(i).reduce((n, x) => n + stages[x], 0), now: stages[s] }));
  const funnelTop = funnel[0].atLeast || 1;
  const maxSource = Math.max(1, ...sources.map((s) => s.total));

  const tiles = [
    { label: "Calls today", value: sum("callsToday"), of: sum("target") || undefined, icon: PhoneCall },
    { label: "Reached today", value: pct(sum("reachedToday"), sum("callsToday")), sub: `${sum("reachedToday")} of ${sum("callsToday")} calls`, icon: PhoneIncoming },
    { label: "Enrolled", value: stages.enrolled, of: details?.enrollmentTarget || undefined, icon: GraduationCap, href: list({ stage: "enrolled" }) },
    { label: "Overdue callbacks", value: sum("overdueCallbacks"), icon: AlarmClock, href: "/callbacks?tab=overdue", alert: sum("overdueCallbacks") > 0 },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`${campaign.name} · everything is live and in Sri Lanka time`}>
        <CampaignPicker campaigns={campaigns.map(({ id, name }) => ({ id, name }))} value={campaign.id} />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <t.icon className="size-4" aria-hidden /> {t.label}
                </CardDescription>
                <CardTitle className={`text-3xl tabular-nums ${t.alert ? "text-destructive" : ""}`}>
                  {t.value}
                  {t.of !== undefined && <span className="text-lg font-normal text-muted-foreground"> / {t.of}</span>}
                </CardTitle>
                {t.sub && <CardDescription>{t.sub}</CardDescription>}
              </CardHeader>
            </Card>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              {body}
            </Link>
          ) : (
            <div key={t.label}>{body}</div>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Callers</CardTitle>
          <CardDescription>Today against each caller&apos;s daily target, and totals for the campaign.</CardDescription>
        </CardHeader>
        <CardContent>
          {!callers.length ? (
            <p className="text-sm text-muted-foreground">No callers on this campaign yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead>
                  <TableHead className="min-w-40">Calls today</TableHead>
                  <TableHead className="hidden md:table-cell">Reached %</TableHead>
                  <TableHead className="hidden sm:table-cell">Open</TableHead>
                  <TableHead className="hidden lg:table-cell">Interested</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead className="hidden md:table-cell">Overdue callbacks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callers.map((c) => (
                  <TableRow key={c.callerId}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" href={list({ caller: c.callerId })}>
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="w-14 shrink-0 tabular-nums">
                          {c.callsToday}
                          {c.target > 0 && <span className="text-muted-foreground">/{c.target}</span>}
                        </span>
                        {c.target > 0 && <Progress value={Math.min(100, (c.callsToday / c.target) * 100)} aria-label={`${c.name}: calls today against target`} />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {pct(c.reached, c.calls)} <span className="text-xs text-muted-foreground">of {c.calls}</span>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{c.open}</TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">{c.interested}</TableCell>
                    <TableCell className="tabular-nums">
                      <Link className="hover:underline" href={list({ caller: c.callerId, stage: "enrolled" })}>
                        {c.enrolled}
                      </Link>
                    </TableCell>
                    <TableCell className={`hidden tabular-nums md:table-cell ${c.overdueCallbacks ? "font-medium text-destructive" : ""}`}>
                      {c.overdueCallbacks}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversion</CardTitle>
            <CardDescription>
              Contacts that got at least this far · {pct(stages.enrolled, total)} of {total} enrolled
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((f) => (
              <Link key={f.stage} href={list({ stage: f.stage })} className="group block rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <div className="flex justify-between text-sm">
                  <span className="group-hover:underline">{STAGE_META[f.stage].label}</span>
                  <span className="tabular-nums">
                    {f.atLeast} <span className="text-muted-foreground">({pct(f.atLeast, total)}) · {f.now} here now</span>
                  </span>
                </div>
                <div className="mt-1 h-3 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-(--series-1)" style={{ width: `${(f.atLeast / funnelTop) * 100}%` }} />
                </div>
              </Link>
            ))}
            <p className="pt-1 text-sm text-muted-foreground">
              Closed:{" "}
              {CLOSED.map((s, i) => (
                <span key={s}>
                  {i > 0 && " · "}
                  <Link className="hover:underline" href={list({ stage: s })}>
                    {STAGE_META[s].label} {stages[s]}
                  </Link>
                </span>
              ))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top sources</CardTitle>
            <CardDescription>Contacts by where they came from, and how many enrolled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!sources.length && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
            {sources.map((s) => (
              <Link key={s.source} href={list({ source: s.source || "(none)" })} className="group block rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <div className="flex justify-between text-sm">
                  <span className="group-hover:underline">{s.source || "No source"}</span>
                  <span className="tabular-nums">
                    {s.total} <span className="text-muted-foreground">· {s.enrolled} enrolled</span>
                  </span>
                </div>
                <div className="mt-1 h-3 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-(--series-1)" style={{ width: `${(s.total / maxSource) * 100}%` }} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Calls per day</CardTitle>
          <CardDescription>Last 14 days, all callers.</CardDescription>
        </CardHeader>
        <CardContent>
          <DailyChart data={daily} />
        </CardContent>
      </Card>
    </>
  );
}
