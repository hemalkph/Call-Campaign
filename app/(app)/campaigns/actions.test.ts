import { beforeEach, expect, it } from "vitest";
import "@/test/mongo";
import { Campaign } from "@/lib/models/campaign";
import { User } from "@/lib/models/user";
import { signedInAs } from "@/test/auth";
import { duplicateCampaign, saveCampaign } from "./actions";

type U = InstanceType<typeof User>;
let owner: U, caller: U;
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
  callers: [{ userId: String(caller._id), dailyCallTarget: Number.NaN }], // blank override
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Campaign.deleteMany({})]);
  [owner, caller] = await User.create([
    { name: "Owner", email: "o@example.test", passwordHash: "x", role: "owner", mustChangePassword: false },
    { name: "Caller", email: "c@example.test", passwordHash: "x", role: "caller", mustChangePassword: false },
  ]);
});

it("is owner-only", async () => {
  signedInAs(caller);
  await expect(saveCampaign(input())).rejects.toThrow(/^REDIRECT \/$/);
});

it("creates, validates and updates a campaign", async () => {
  signedInAs(owner);
  expect(await saveCampaign({ ...input(), endDate: "2026-09-01" })).toMatchObject({ ok: false });
  expect(await saveCampaign({ ...input(), callers: [{ userId: String(owner._id) }] })).toMatchObject({ ok: false }); // not a caller

  const res = await saveCampaign(input());
  expect(res.ok).toBe(true);
  const id = res.ok ? res.id : "";
  expect((await Campaign.findById(id))?.callers[0].dailyCallTarget).toBeUndefined();

  await saveCampaign({ ...input(), id, callers: [{ userId: String(caller._id), dailyCallTarget: 80 }] });
  expect(await Campaign.countDocuments()).toBe(1);
  expect((await Campaign.findById(id))?.callers[0].dailyCallTarget).toBe(80);
});

it("duplicates a campaign as a draft", async () => {
  signedInAs(owner);
  const res = await saveCampaign(input());
  const copy = await duplicateCampaign(res.ok ? res.id : "");
  expect(copy.ok).toBe(true);
  expect(await Campaign.findById(copy.ok ? copy.id : "")).toMatchObject({
    name: "Copy of October intake",
    status: "draft",
    script: "Hello {name}",
    fee: "Rs. 2,500",
    dailyCallTarget: 60,
  });
});
