"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { Contact } from "@/lib/models/contact";
import { Template } from "@/lib/models/template";
import { WhatsappLog } from "@/lib/models/whatsapp-log";
import { whatsappSentSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

type Result = { ok: true; lastWhatsappAt: string | null } | { ok: false; error: string };

/** "Mark as sent" logs a message; unmarking removes this user's latest log for the contact. */
export async function setWhatsappSent(input: unknown): Promise<Result> {
  const me = await requireUser();
  const p = whatsappSentSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { contactId, templateId, sent } = p.data;

  const contact = await Contact.findOne(
    me.role === "owner" ? { _id: contactId } : { _id: contactId, assignedTo: new Types.ObjectId(me.id) },
    { campaignId: 1 },
  ).lean();
  if (!contact) return { ok: false, error: "Contact not found." };

  if (sent) {
    const template = templateId ? await Template.findById(templateId, { name: 1 }).lean() : null;
    await WhatsappLog.create({
      campaignId: contact.campaignId,
      contactId,
      callerId: me.id,
      templateId: template?._id,
      templateName: template?.name ?? "",
    });
  } else {
    const latest = await WhatsappLog.findOne({ contactId, callerId: me.id }).sort({ sentAt: -1 });
    if (latest) await latest.deleteOne();
  }
  const last = await WhatsappLog.findOne({ contactId }, { sentAt: 1 }).sort({ sentAt: -1 }).lean();
  await Contact.updateOne({ _id: contactId }, { lastWhatsappAt: last?.sentAt ?? null });
  revalidatePath("/whatsapp");
  return { ok: true, lastWhatsappAt: last?.sentAt.toISOString() ?? null };
}
