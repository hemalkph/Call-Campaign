import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { filterOptions, listContacts, PAGE_SIZE, parseListParams, visibleCampaigns } from "@/lib/contacts-query";
import { User } from "@/lib/models/user";
import { requireUser } from "@/lib/session";
import { ContactsView } from "./contacts-view";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = parseListParams(await searchParams);
  const campaigns = await visibleCampaigns(user);
  const title = user.role === "owner" ? "Contacts" : "My contacts";

  if (!campaigns.length)
    return (
      <>
        <PageHeader title={title} />
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {user.role === "owner" ? (
            <>
              <p className="mb-3">Create a campaign first, then add or import contacts into it.</p>
              <Button asChild>
                <Link href="/campaigns">Go to campaigns</Link>
              </Button>
            </>
          ) : (
            "You're not on any campaign yet. Ask the owner to add you."
          )}
        </div>
      </>
    );

  const campaign = campaigns.find((c) => c.id === params.campaign) ?? campaigns[0];
  const [{ rows, total }, options, users] = await Promise.all([
    listContacts(user, campaign.id, params),
    filterOptions(user, campaign.id),
    user.role === "owner" ? User.find({ role: "caller" }, { name: 1 }).lean() : Promise.resolve([]),
  ]);
  const userNames = Object.fromEntries(users.map((u) => [String(u._id), u.name]));

  return (
    <>
      <PageHeader title={title} description={`${total} ${total === 1 ? "contact" : "contacts"} match`} />
      <ContactsView
        role={user.role}
        campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
        campaignId={campaign.id}
        params={{ ...params, campaign: campaign.id }}
        total={total}
        pageSize={PAGE_SIZE}
        options={options}
        callers={campaign.callerIds.map((id) => ({ id, name: userNames[id] ?? "Unknown" }))}
        userNames={userNames}
        rows={rows.map((c) => ({
          id: String(c._id),
          name: c.name,
          phone: c.phone,
          altPhone: c.altPhone ?? "",
          school: c.school ?? "",
          district: c.district ?? "",
          gradeOrBatch: c.gradeOrBatch ?? "",
          source: c.source ?? "",
          tags: c.tags,
          notes: c.notes,
          assignedTo: c.assignedTo ? String(c.assignedTo) : null,
          stage: c.stage,
          lastCallAt: c.lastCallAt?.toISOString() ?? null,
          lastOutcome: c.lastOutcome ?? null,
          nextCallbackAt: c.nextCallbackAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
