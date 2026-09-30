import Link from "next/link";
import { CampaignPicker } from "@/components/campaign-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { visibleCampaigns } from "@/lib/contacts-query";
import { and, desc, eq } from "drizzle-orm";
import { contacts, db, users } from "@/lib/db";
import { stageCounts } from "@/lib/reports";
import { requireOwner } from "@/lib/session";
import { STAGES } from "@/lib/vocab";
import { Board } from "./board";

export const metadata = { title: "Pipeline" };

const PER_COLUMN = 30;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const me = await requireOwner();
  const campaigns = await visibleCampaigns(me);
  if (!campaigns.length)
    return (
      <>
        <PageHeader title="Pipeline" />
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No campaigns yet.{" "}
          <Button asChild variant="link" className="px-0">
            <Link href="/campaigns">Create one</Link>
          </Button>
        </p>
      </>
    );
  const requested = (await searchParams).campaign;
  const campaign = campaigns.find((c) => c.id === requested) ?? campaigns[0];

  const [counts, columns] = await Promise.all([
    stageCounts(campaign.id),
    Promise.all(
      STAGES.map((stage) =>
        db
          .select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
            school: contacts.school,
            lastOutcome: contacts.lastOutcome,
            caller: users.name,
          })
          .from(contacts)
          .leftJoin(users, eq(users.id, contacts.assignedTo))
          .where(and(eq(contacts.campaignId, campaign.id), eq(contacts.stage, stage)))
          .orderBy(desc(contacts.stageChangedAt))
          .limit(PER_COLUMN),
      ),
    ),
  ]);

  return (
    <>
      <PageHeader title="Pipeline" description="Drag a card to change its stage, or use its “Move” menu.">
        <CampaignPicker campaigns={campaigns.map(({ id, name }) => ({ id, name }))} value={campaign.id} />
      </PageHeader>
      <Board
        key={campaign.id}
        campaignId={campaign.id}
        counts={counts}
        cards={columns.flatMap((column, i) => column.map((c) => ({ ...c, caller: c.caller ?? "", stage: STAGES[i] })))}
      />
    </>
  );
}
