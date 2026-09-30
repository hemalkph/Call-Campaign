"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contacts, db, templates, whatsappLogs } from "@/lib/db";
import { whatsappSentSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

type Result = { ok: true; lastWhatsappAt: string | null } | { ok: false; error: string };

/** "Mark as sent" logs a message; unmarking removes this user's latest log for the contact. */
export async function setWhatsappSent(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = whatsappSentSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { contactId, templateId, sent } = p.data;

  const [contact] = await db
    .select({ campaignId: contacts.campaignId })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), me.role === "owner" ? undefined : eq(contacts.assignedTo, me.id)));
  if (!contact) return { ok: false, error: "Contact not found." };

  const last = await db.transaction(async (tx) => {
    if (sent) {
      const [template] = templateId ? await tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.id, templateId)) : [];
      await tx.insert(whatsappLogs).values({
        campaignId: contact.campaignId,
        contactId,
        callerId: me.id,
        templateId: template?.id ?? null,
        templateName: template?.name ?? "",
      });
    } else {
      const [latest] = await tx
        .select({ id: whatsappLogs.id })
        .from(whatsappLogs)
        .where(and(eq(whatsappLogs.contactId, contactId), eq(whatsappLogs.callerId, me.id)))
        .orderBy(desc(whatsappLogs.sentAt))
        .limit(1);
      if (latest) await tx.delete(whatsappLogs).where(eq(whatsappLogs.id, latest.id));
    }
    const [newest] = await tx
      .select({ sentAt: whatsappLogs.sentAt })
      .from(whatsappLogs)
      .where(eq(whatsappLogs.contactId, contactId))
      .orderBy(desc(whatsappLogs.sentAt))
      .limit(1);
    await tx.update(contacts).set({ lastWhatsappAt: newest?.sentAt ?? null }).where(eq(contacts.id, contactId));
    return newest?.sentAt ?? null;
  });
  revalidatePath("/whatsapp");
  return { ok: true, lastWhatsappAt: last?.toISOString() ?? null };
}
