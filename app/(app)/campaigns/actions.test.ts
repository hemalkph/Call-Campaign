import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { campaignCallers, campaigns } from "@/lib/db";
import { signedInAs } from "@/test/auth";
import { resetDb, testDb as db } from "@/test/db";
import { makeUser, type TestUser } from "@/test/fixtures";
import { duplicateCampaign, saveCampaign } from "./actions";

let owner: TestUser, caller: TestUser;
const input = () => ({
  name: "October intake",
  classLabel: "2027 A/L Theory",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  status: "active",
  dailyCallTarget: 60,
  enrollmentTarget: 40,
  script: "Hello {name}",
  fee: "Rs. 2,500",
  link: "",
  callers: [{ userId: caller.id, dailyCallTarget: Number.NaN }], // blank override
});
const callersOf = (id: string) => db.select().from(campaignCallers).where(eq(campaignCallers.campaignId, id));

beforeEach(async () => {
  await resetDb();
  owner = await makeUser("Owner", "owner");
  caller = await makeUser("Caller", "caller");
});

it("is owner-only", async () => {
  signedInAs(caller);
  await expect(saveCampaign(input())).rejects.toThrow(/^REDIRECT \/$/);
});

it("creates, validates and updates a campaign", async () => {
  signedInAs(owner);
  expect(await saveCampaign({ ...input(), endDate: "2026-09-01" })).toMatchObject({ ok: false });
  expect(await saveCampaign({ ...input(), callers: [{ userId: owner.id }] })).toMatchObject({ ok: false }); // not a caller

  const res = await saveCampaign(input());
  expect(res.ok).toBe(true);
  const id = res.ok ? res.id : "";
  expect((await callersOf(id))[0].dailyCallTarget).toBeNull();

  await saveCampaign({ ...input(), id, callers: [{ userId: caller.id, dailyCallTarget: 80 }] });
  expect(await db.select().from(campaigns)).toHaveLength(1);
  expect(await callersOf(id)).toMatchObject([{ userId: caller.id, dailyCallTarget: 80 }]);
});

it("duplicates a campaign as a draft, with its callers", async () => {
  signedInAs(owner);
  const res = await saveCampaign(input());
  const copy = await duplicateCampaign(res.ok ? res.id : "");
  expect(copy.ok).toBe(true);
  const copyId = copy.ok ? copy.id : "";
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, copyId));
  expect(c).toMatchObject({ name: "Copy of October intake", status: "draft", script: "Hello {name}", fee: "Rs. 2,500", dailyCallTarget: 60 });
  expect(await callersOf(copyId)).toMatchObject([{ userId: caller.id }]);
});
