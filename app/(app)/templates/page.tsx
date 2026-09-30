import { PageHeader } from "@/components/page-header";
import { asc } from "drizzle-orm";
import { db, templates as templatesTable } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { TemplateDialog, TemplateList } from "./template-list";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  await requireOwner();
  const templates = await db.select().from(templatesTable).orderBy(asc(templatesTable.language), asc(templatesTable.name));
  return (
    <>
      <PageHeader title="WhatsApp templates" description="Messages callers can send with one tap. WhatsApp opens with the text filled in.">
        <TemplateDialog />
      </PageHeader>
      <TemplateList templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.body }))} />
    </>
  );
}
