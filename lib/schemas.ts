// Zod schemas shared by client forms and server actions.
import { z } from "zod";
import { normalizePhone } from "./phone";
import { CAMPAIGN_STATUSES, OUTCOMES, STAGES } from "./vocab";

export const ROLES = ["owner", "caller"] as const;
export type Role = (typeof ROLES)[number];

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});

/** Optional phone: blank → undefined, otherwise normalized or rejected. */
export const optionalPhone = z
  .string()
  .trim()
  .optional() // undefined too, so the server can re-validate the client's parsed output
  .transform((v, ctx) => {
    if (!v) return undefined;
    const r = normalizePhone(v);
    if (r.ok) return r.phone;
    ctx.addIssue({ code: "custom", message: "Enter a valid Sri Lankan phone number" });
    return z.NEVER;
  });

export const requiredPhone = optionalPhone.refine((v) => v !== undefined, "Enter a phone number").transform((v) => v!);

export const createUserSchema = z.strictObject({
  name: z.string().trim().min(2, "Enter a name").max(100),
  email,
  phone: optionalPhone,
  role: z.enum(ROLES),
});

export const userIdSchema = z.strictObject({ userId: objectId });

/** Owner sets (or generates) a new password for someone else. */
export const resetPasswordSchema = z
  .strictObject({
    userId: objectId,
    password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
export const setActiveSchema = z.strictObject({ userId: objectId, active: z.boolean() });

export const newPasswordSchema = z
  .strictObject({
    current: z.string().min(1, "Enter your current password").max(200),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
  .refine((v) => v.password !== v.current, { path: ["password"], message: "Choose a new password" });

// ---- Campaigns ----

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const count = z.number("Enter a number").int("Whole numbers only").min(0).max(100_000);
/** Blank number inputs arrive as NaN (valueAsNumber) → undefined. */
const optionalCount = z.preprocess((v) => (v === "" || v === null || Number.isNaN(v) ? undefined : v), count.optional());

export const campaignSchema = z
  .strictObject({
    id: objectId.optional(),
    name: z.string().trim().min(2, "Enter a name").max(120),
    classLabel: z.string().trim().min(1, "Enter the class / intake").max(120),
    startDate: day,
    endDate: day,
    status: z.enum(CAMPAIGN_STATUSES),
    dailyCallTarget: count,
    enrollmentTarget: count,
    script: z.string().max(20_000),
    fee: z.string().trim().max(100),
    link: z.union([z.literal(""), z.url("Enter a full link starting with https://").max(500)]),
    callers: z.array(z.strictObject({ userId: objectId, dailyCallTarget: optionalCount })).max(100),
  })
  .refine((c) => c.endDate >= c.startDate, { path: ["endDate"], message: "Ends before it starts" });

// ---- Contacts ----

const text = (max: number) => z.string().trim().max(max);

export const contactFields = z.strictObject({
  name: z.string().trim().min(1, "Enter a name").max(120),
  phone: requiredPhone,
  altPhone: optionalPhone,
  school: text(120),
  district: text(60),
  gradeOrBatch: text(60),
  source: text(80),
  /** Comma-separated in the form, an array in the database. Accepts either, so parsing twice is safe. */
  tags: z
    .union([text(500), z.array(text(40))])
    .transform((v) => [...new Set((typeof v === "string" ? v.split(",") : v).map((t) => t.trim()).filter(Boolean))].slice(0, 20)),
  notes: text(5000),
  assignedTo: z.union([objectId, z.literal("")]).optional(), // owner only; "" = unassigned
  stage: z.enum(STAGES).optional(),
});

export const createContactSchema = contactFields.extend({ campaignId: objectId });
export const updateContactSchema = contactFields.extend({ id: objectId });

const ids = z.array(objectId).min(1, "Select contacts").max(500);
export const bulkContactsSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("reassign"), ids, assignedTo: z.union([objectId, z.literal("")]) }),
  z.strictObject({ action: z.literal("stage"), ids, stage: z.enum(STAGES) }),
  z.strictObject({ action: z.literal("addTag"), ids, tag: z.string().trim().min(1).max(40) }),
]);

// ---- Calling ----

export const logCallSchema = z.strictObject({
  contactId: objectId,
  outcome: z.enum(OUTCOMES),
  notes: z.string().trim().max(2000),
  durationSec: z.number().int().min(0).max(4 * 3600).optional(),
  callbackAt: z.iso.datetime().optional(), // required for callback_requested
  callbackNote: z.string().trim().max(500).optional(),
});

export const rescheduleSchema = z.strictObject({ id: objectId, dueAt: z.iso.datetime(), note: z.string().trim().max(500).optional() });
export const cancelCallbackSchema = z.strictObject({ id: objectId, reason: z.string().trim().min(1, "Give a reason").max(300) });

export const templateSchema = z.strictObject({
  id: objectId.optional(),
  name: z.string().trim().min(1, "Enter a name").max(80),
  language: z.enum(["si", "en"]),
  body: z.string().trim().min(1, "Write the message").max(2000),
});

export const whatsappSentSchema = z.strictObject({
  contactId: objectId,
  templateId: objectId.optional(),
  sent: z.boolean(),
});
