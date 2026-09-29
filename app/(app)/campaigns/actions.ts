"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/models/audit-event";
import { Campaign } from "@/lib/models/campaign";
import { User } from "@/lib/models/user";
import { campaignSchema, objectId } from "@/lib/schemas";
import { requireOwner } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function saveCampaign(input: unknown): Promise<Result<{ id: string }>> {
  const me = await requireOwner();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { id, ...data } = parsed.data;

  const callerIds = data.callers.map((c) => c.userId);
  const valid = await User.countDocuments({ _id: { $in: callerIds }, role: "caller" });
  if (valid !== new Set(callerIds).size) return { ok: false, error: "One of the selected callers no longer exists." };

  const summary = { name: data.name, status: data.status, callers: callerIds };
  let campaignId = id;
  if (id) {
    const before = await Campaign.findByIdAndUpdate(id, data);
    if (!before) return { ok: false, error: "Campaign not found." };
    await audit({
      actorId: me.id,
      action: "campaign.update",
      entity: "campaigns",
      entityId: id,
      before: { name: before.name, status: before.status, callers: before.callers.map((c) => String(c.userId)) },
      after: summary,
    });
  } else {
    const created = await Campaign.create(data);
    campaignId = String(created._id);
    await audit({ actorId: me.id, action: "campaign.create", entity: "campaigns", entityId: created._id, after: summary });
  }
  revalidatePath("/campaigns");
  return { ok: true, id: campaignId! };
}

/** Copies settings, callers and script into a new draft; contacts are not copied. */
export async function duplicateCampaign(input: unknown): Promise<Result<{ id: string }>> {
  const me = await requireOwner();
  const id = objectId.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const src = await Campaign.findById(id.data).lean();
  if (!src) return { ok: false, error: "Campaign not found." };

  const { _id, createdAt, updatedAt, ...rest } = src; // eslint-disable-line @typescript-eslint/no-unused-vars
  const copy = await Campaign.create({ ...rest, name: `Copy of ${src.name}`, status: "draft" });
  await audit({
    actorId: me.id,
    action: "campaign.duplicate",
    entity: "campaigns",
    entityId: copy._id,
    after: { from: String(src._id), name: copy.name },
  });
  revalidatePath("/campaigns");
  return { ok: true, id: String(copy._id) };
}
