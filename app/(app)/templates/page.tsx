import { PageHeader } from "@/components/page-header";
import { Template } from "@/lib/models/template";
import { requireOwner } from "@/lib/session";
import { TemplateDialog, TemplateList } from "./template-list";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  await requireOwner();
  const templates = await Template.find().sort({ language: 1, name: 1 }).lean();
  return (
    <>
      <PageHeader title="WhatsApp templates" description="Messages callers can send with one tap. WhatsApp opens with the text filled in.">
        <TemplateDialog />
      </PageHeader>
      <TemplateList templates={templates.map((t) => ({ id: String(t._id), name: t.name, language: t.language, body: t.body }))} />
    </>
  );
}
