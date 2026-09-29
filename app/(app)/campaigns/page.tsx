import { PageHeader } from "@/components/page-header";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { User } from "@/lib/models/user";
import { requireOwner } from "@/lib/session";
import { CampaignList, CampaignSheet } from "./campaign-list";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await requireOwner();
  const [campaigns, counts, callers] = await Promise.all([
    Campaign.find().sort({ status: 1, startDate: -1 }).lean(),
    Contact.aggregate<{ _id: unknown; total: number; enrolled: number }>([
      { $group: { _id: "$campaignId", total: { $sum: 1 }, enrolled: { $sum: { $cond: [{ $eq: ["$stage", "enrolled"] }, 1, 0] } } } },
    ]),
    User.find({ role: "caller", active: true }, { name: 1 }).sort({ name: 1 }).lean(),
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c]));

  return (
    <>
      <PageHeader title="Campaigns" description="Each intake's calling campaign, its callers and targets.">
        <CampaignSheet callers={callers.map((c) => ({ id: String(c._id), name: c.name }))} />
      </PageHeader>
      <CampaignList
        callers={callers.map((c) => ({ id: String(c._id), name: c.name }))}
        campaigns={campaigns.map((c) => ({
          id: String(c._id),
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
          callers: c.callers.map((x) => ({ userId: String(x.userId), dailyCallTarget: x.dailyCallTarget ?? undefined })),
          contacts: countBy.get(String(c._id))?.total ?? 0,
          enrolled: countBy.get(String(c._id))?.enrolled ?? 0,
        }))}
      />
    </>
  );
}
