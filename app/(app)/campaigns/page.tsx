import { PageHeader } from "@/components/page-header";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { callersOf } from "@/lib/contacts-query";
import { campaigns as campaignsTable, contacts, db, users } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { CampaignList, CampaignSheet } from "./campaign-list";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await requireOwner();
  const [campaigns, counts, callers] = await Promise.all([
    db.select().from(campaignsTable).orderBy(asc(campaignsTable.status), desc(campaignsTable.startDate)),
    db
      .select({
        campaignId: contacts.campaignId,
        total: sql<number>`count(*)::int`,
        enrolled: sql<number>`(count(*) filter (where ${contacts.stage} = 'enrolled'))::int`,
      })
      .from(contacts)
      .groupBy(contacts.campaignId),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "caller"), eq(users.active, true))).orderBy(asc(users.name)),
  ]);
  const countBy = new Map(counts.map((c) => [c.campaignId, c]));
  const callersFor = await callersOf(campaigns.map((c) => c.id));

  return (
    <>
      <PageHeader title="Campaigns" description="Each intake's calling campaign, its callers and targets.">
        <CampaignSheet callers={callers} />
      </PageHeader>
      <CampaignList
        callers={callers}
        campaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          classLabel: c.classLabel,
          startDate: c.startDate,
          endDate: c.endDate,
          status: c.status,
          dailyCallTarget: c.dailyCallTarget,
          enrollmentTarget: c.enrollmentTarget,
          script: c.script,
          fee: c.fee,
          link: c.link,
          callers: callersFor(c.id).map((x) => ({ userId: x.userId, dailyCallTarget: x.dailyCallTarget ?? undefined })),
          contacts: countBy.get(c.id)?.total ?? 0,
          enrolled: countBy.get(c.id)?.enrolled ?? 0,
        }))}
      />
    </>
  );
}
