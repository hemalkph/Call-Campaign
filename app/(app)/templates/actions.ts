"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db, templates } from "@/lib/db";
import { recordId, templateSchema } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

export async function saveTemplate(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const p = templateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, ...data } = p.data;
  const [doc] = id
    ? await db.update(templates).set(data).where(eq(templates.id, id)).returning({ id: templates.id })
    : await db.insert(templates).values(data).returning({ id: templates.id });
  if (!doc) return { ok: false, error: "Template not found." };
  await audit({ actorId: me.id, action: id ? "template.update" : "template.create", entity: "templates", entityId: doc.id, after: { name: data.name } });
  revalidatePath("/templates");
  return { ok: true };
}

export async function deleteTemplate(input: unknown): Promise<Result> {
  const me = await requireOwner();
  const id = recordId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const [doc] = await db.delete(templates).where(eq(templates.id, id.data)).returning({ id: templates.id, name: templates.name });
  if (!doc) return { ok: false, error: "Template not found." };
  await audit({ actorId: me.id, action: "template.delete", entity: "templates", entityId: doc.id, before: { name: doc.name } });
  revalidatePath("/templates");
  return { ok: true };
}
