import { Types } from "mongoose";
import Link from "next/link";
import { CampaignPicker } from "@/components/campaign-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { visibleCampaigns } from "@/lib/contacts-query";
import { Contact } from "@/lib/models/contact";
import { User } from "@/lib/models/user";
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
  const cid = new Types.ObjectId(campaign.id);

  const [counts, columns, users] = await Promise.all([
    stageCounts(campaign.id),
    Promise.all(
      STAGES.map((stage) =>
        Contact.find({ campaignId: cid, stage }, { name: 1, phone: 1, assignedTo: 1, lastOutcome: 1, school: 1 })
          .sort({ stageChangedAt: -1 })
          .limit(PER_COLUMN)
          .lean(),
      ),
    ),
    User.find({ role: "caller" }, { name: 1 }).lean(),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.name]));

  return (
    <>
      <PageHeader title="Pipeline" description="Drag a card to change its stage, or use its “Move” menu.">
        <CampaignPicker campaigns={campaigns.map(({ id, name }) => ({ id, name }))} value={campaign.id} />
      </PageHeader>
      <Board
        key={campaign.id}
        campaignId={campaign.id}
        counts={counts}
        cards={columns.flatMap((column, i) => column.map((c) => ({
          id: String(c._id),
          name: c.name,
          phone: c.phone,
          school: c.school ?? "",
          caller: c.assignedTo ? (names.get(String(c.assignedTo)) ?? "") : "",
          lastOutcome: c.lastOutcome ?? null,
          stage: STAGES[i],
        })))}
      />
    </>
  );
}
