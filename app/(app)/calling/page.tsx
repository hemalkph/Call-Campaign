import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { activeCampaignsFor } from "@/lib/contacts-query";
import { Call } from "@/lib/models/call";
import { Contact } from "@/lib/models/contact";
import { Template } from "@/lib/models/template";
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
  const chosen = /^[a-f\d]{24}$/i.test(sp.contact ?? "")
    ? await Contact.findOne({ _id: sp.contact, campaignId: campaign.id, assignedTo: me.id }).lean()
    : null;
  const next = chosen ? { contact: chosen, reason: "chosen" as const } : await findNextContact(me.id, campaign.id);
  const [card, callsToday, templates] = await Promise.all([
    next ? toCard(next.contact, next.reason) : null,
    Call.countDocuments({ callerId: me.id, campaignId: campaign.id, calledAt: { $gte: dayBounds().start } }),
    Template.find().sort({ language: 1, name: 1 }).lean(),
  ]);

  return (
    <CallingView
      key={campaign.id}
      me={{ name: me.name }}
      campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
      campaign={campaign}
      initialCard={card}
      callsToday={callsToday}
      templates={templates.map((t) => ({ id: String(t._id), name: t.name, language: t.language, body: t.body }))}
      emptyAction={
        <Button asChild variant="outline">
          <Link href="/today">Back to Today</Link>
        </Button>
      }
    />
  );
}
