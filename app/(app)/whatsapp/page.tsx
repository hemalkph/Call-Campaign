import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { activeCampaignsFor, listContacts, PAGE_SIZE, parseListParams } from "@/lib/contacts-query";
import { asc } from "drizzle-orm";
import { db, templates as templatesTable } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { WhatsAppList } from "./whatsapp-list";

export const metadata = { title: "WhatsApp" };

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const params = parseListParams(await searchParams);
  const campaigns = await activeCampaignsFor(me);
  if (!campaigns.length)
    return (
      <>
        <PageHeader title="WhatsApp" />
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          You&apos;re not on an active campaign.{" "}
          <Button asChild variant="link" className="px-0">
            <Link href="/today">Back to Today</Link>
          </Button>
        </p>
      </>
    );

  const campaign = campaigns.find((c) => c.id === params.campaign) ?? campaigns[0];
  const [{ rows, total }, templates] = await Promise.all([
    listContacts(me, campaign.id, { ...params, sort: "name", dir: "asc" }),
    db.select().from(templatesTable).orderBy(asc(templatesTable.language), asc(templatesTable.name)),
  ]);

  return (
    <>
      <PageHeader title="WhatsApp" description="Open WhatsApp with a message, then mark it as sent." />
      <WhatsAppList
        me={{ name: me.name }}
        campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
        campaign={campaign}
        params={{ ...params, campaign: campaign.id }}
        total={total}
        pageSize={PAGE_SIZE}
        templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.body }))}
        rows={rows.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          stage: c.stage,
          lastWhatsappAt: c.lastWhatsappAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
