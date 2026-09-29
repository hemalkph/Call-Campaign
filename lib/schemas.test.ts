import { expect, it } from "vitest";
import { campaignSchema, contactFields, createUserSchema } from "./schemas";

// Forms validate on the client, then the server validates the *output* again.
it.each([
  ["contact", contactFields, { name: " A ", phone: "771234567", altPhone: "+94 77 123 4568", school: "", district: "", gradeOrBatch: "", source: "", tags: "x, y, x", notes: "", assignedTo: "" }],
  ["contact, blanks", contactFields, { name: "B", phone: "0771234567", altPhone: "", school: "", district: "", gradeOrBatch: "", source: "", tags: "", notes: "" }],
  ["user, no phone", createUserSchema, { name: "Caller", email: "b@example.test", phone: "", role: "caller" }],
  ["user", createUserSchema, { name: "Caller", email: " A@Example.test ", phone: "0771234567", role: "caller" }],
  ["campaign", campaignSchema, { name: "Oct", classLabel: "A/L", startDate: "2026-10-01", endDate: "2026-10-02", status: "draft", dailyCallTarget: 1, enrollmentTarget: 2, script: "", fee: "", link: "https://example.test/join", callers: [{ userId: "6abb775522b1ba96fb2ff6ad", dailyCallTarget: Number.NaN }] }],
] as const)("%s schema accepts its own output", (_, schema, input) => {
  const once = (schema as typeof contactFields).parse(input);
  expect((schema as typeof contactFields).parse(once)).toEqual(once);
});
