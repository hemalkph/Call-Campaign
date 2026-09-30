"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { campaignCallers, campaigns, db, users } from "@/lib/db";
import { campaignSchema, recordId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function saveCampaign(input: unknown): Promise<Result<{ id: string }>> {
  const me = await requireOwner();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, callers, ...data } = parsed.data;

  const callerIds = [...new Set(callers.map((c) => c.userId))];
  const valid = callerIds.length
    ? await db.select({ id: users.id }).from(users).where(and(inArray(users.id, callerIds), eq(users.role, "caller")))
    : [];
  if (valid.length !== callerIds.length) return { ok: false, error: "One of the selected callers no longer exists." };

  const summary = { name: data.name, status: data.status, callers: callerIds };
  const result = await db.transaction(async (tx) => {
    let campaignId = id;
    if (id) {
      const [before] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
      if (!before) return null;
      const beforeCallers = await tx.select({ userId: campaignCallers.userId }).from(campaignCallers).where(eq(campaignCallers.campaignId, id));
      await tx.update(campaigns).set(data).where(eq(campaigns.id, id));
      await tx.delete(campaignCallers).where(eq(campaignCallers.campaignId, id));
      await audit(
        {
          actorId: me.id,
          action: "campaign.update",
          entity: "campaigns",
          entityId: id,
          before: { name: before.name, status: before.status, callers: beforeCallers.map((c) => c.userId) },
          after: summary,
        },
        tx,
      );
    } else {
      [{ id: campaignId }] = await tx.insert(campaigns).values(data).returning({ id: campaigns.id });
      await audit({ actorId: me.id, action: "campaign.create", entity: "campaigns", entityId: campaignId, after: summary }, tx);
    }
    if (callers.length)
      await tx
        .insert(campaignCallers)
        .values(callers.map((c, position) => ({ campaignId: campaignId!, userId: c.userId, dailyCallTarget: c.dailyCallTarget ?? null, position })));
    return campaignId!;
  });
  if (!result) return { ok: false, error: "Campaign not found." };
  revalidatePath("/campaigns");
  return { ok: true, id: result };
}

/** Copies settings, callers and script into a new draft; contacts are not copied. */
export async function duplicateCampaign(input: unknown): Promise<Result<{ id: string }>> {
  const me = await requireOwner();
  const id = recordId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const [src] = await db.select().from(campaigns).where(eq(campaigns.id, id.data));
  if (!src) return { ok: false, error: "Campaign not found." };

  const copyId = await db.transaction(async (tx) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src; // eslint-disable-line @typescript-eslint/no-unused-vars
    const [copy] = await tx.insert(campaigns).values({ ...rest, name: `Copy of ${src.name}`, status: "draft" }).returning();
    const callers = await tx.select().from(campaignCallers).where(eq(campaignCallers.campaignId, src.id));
    if (callers.length) await tx.insert(campaignCallers).values(callers.map((c) => ({ ...c, campaignId: copy.id })));
    await audit(
      { actorId: me.id, action: "campaign.duplicate", entity: "campaigns", entityId: copy.id, after: { from: src.id, name: copy.name } },
      tx,
    );
    return copy.id;
  });
  revalidatePath("/campaigns");
  return { ok: true, id: copyId };
}
