"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/models/audit-event";
import { Template } from "@/lib/models/template";
import { objectId, templateSchema } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

export async function saveTemplate(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const p = templateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, ...data } = p.data;
  const doc = id ? await Template.findByIdAndUpdate(id, data) : await Template.create(data);
  if (!doc) return { ok: false, error: "Template not found." };
  await audit({ actorId: me.id, action: id ? "template.update" : "template.create", entity: "templates", entityId: doc._id, after: { name: data.name } });
  revalidatePath("/templates");
  return { ok: true };
}

export async function deleteTemplate(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const id = objectId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const doc = await Template.findByIdAndDelete(id.data);
  if (!doc) return { ok: false, error: "Template not found." };
  await audit({ actorId: me.id, action: "template.delete", entity: "templates", entityId: doc._id, before: { name: doc.name } });
  revalidatePath("/templates");
  return { ok: true };
}
