import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { activeCampaignsFor } from "@/lib/contacts-query";
import { and, asc, count, eq, gte } from "drizzle-orm";
import { calls, contacts, db, templates as templatesTable } from "@/lib/db";
import { recordId } from "@/lib/schemas";
import { findNextContact, toCard } from "@/lib/next-contact";
import { requireUser } from "@/lib/session";
import { dayBounds } from "@/lib/time";
import { CallingView } from "./calling-view";

export const metadata = { title: "Calling" };

export default async function CallingPage({ searchParams }: { searchParams: Promise<{ campaign?: string; contact?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const campaigns = await activeCampaignsFor(me);
  if (!campaigns.length)
    return (
      <>
        <PageHeader title="Calling" />
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          You&apos;re not on an active campaign. Ask the owner to add you.
        </p>
      </>
    );

  const campaign = campaigns.find((c) => c.id === sp.campaign) ?? campaigns[0];
  const contactId = recordId.safeParse(sp.contact);
  const [chosen] = contactId.success
    ? await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId.data), eq(contacts.campaignId, campaign.id), eq(contacts.assignedTo, me.id)))
    : [];
  const next = chosen ? { contact: chosen, reason: "chosen" as const } : await findNextContact(me.id, campaign.id);
  const [card, [{ callsToday }], templates] = await Promise.all([
    next ? toCard(next.contact, next.reason) : null,
    db
      .select({ callsToday: count() })
      .from(calls)
      .where(and(eq(calls.callerId, me.id), eq(calls.campaignId, campaign.id), gte(calls.calledAt, dayBounds().start))),
    db.select().from(templatesTable).orderBy(asc(templatesTable.language), asc(templatesTable.name)),
  ]);

  return (
    <CallingView
      key={campaign.id}
      me={{ name: me.name }}
      campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
      campaign={campaign}
      initialCard={card}
      callsToday={callsToday}
      templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.body }))}
      emptyAction={
        <Button asChild variant="outline">
          <Link href="/today">Back to Today</Link>
        </Button>
      }
    />
  );
}
