// PostgreSQL tables (Drizzle). Column names are snake_case in the database (see `casing` in lib/db/index.ts).
// Timestamps are timestamptz (UTC); campaign start/end are calendar dates.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { STRATEGIES } from "../import";
import { ROLES } from "../schemas";
import { CAMPAIGN_STATUSES, OUTCOMES, STAGES } from "../vocab";

/** Time-ordered UUID (v7): unique like a random UUID, but inserts stay in index order. */
export function uuidv7() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const id = () => uuid().primaryKey().$defaultFn(uuidv7).default(sql`gen_random_uuid()`);
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const oneOf = (column: string, values: readonly string[]) => sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(), // stored lower-case
    passwordHash: text().notNull(),
    role: text({ enum: ROLES }).notNull(),
    active: boolean().notNull().default(true),
    phone: text(), // normalized 07XXXXXXXX
    mustChangePassword: boolean().notNull().default(true),
    // Bumped on password reset / deactivation; sessions carrying an older value are rejected.
    tokenVersion: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check("users_role_check", oneOf("role", ROLES))],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    name: text().notNull(),
    classLabel: text().notNull(), // e.g. "2027 A/L Theory"
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    status: text({ enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
    dailyCallTarget: integer().notNull().default(0),
    enrollmentTarget: integer().notNull().default(0),
    script: text().notNull().default(""), // markdown
    fee: text().notNull().default(""), // {fee} placeholder
    link: text().notNull().default(""), // {link} placeholder
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("campaigns_status_check", oneOf("status", CAMPAIGN_STATUSES)),
    check("campaigns_dates_check", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

/** Callers working a campaign. dailyCallTarget overrides the campaign default when set. */
export const campaignCallers = pgTable(
  "campaign_callers",
  {
    campaignId: uuid().notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid().notNull().references(() => users.id),
    dailyCallTarget: integer(),
    position: integer().notNull().default(0), // keeps the owner's chosen order
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] }), index().on(t.userId)],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: id(),
    key: text().notNull().unique(), // idempotency key from the browser
    campaignId: uuid().notNull().references(() => campaigns.id),
    createdBy: uuid().notNull().references(() => users.id),
    fileName: text().notNull().default(""),
    mapping: jsonb().$type<Record<string, string>>(), // field → column header (no personal data)
    strategy: text({ enum: STRATEGIES }).notNull(),
    oneCallerId: uuid().references(() => users.id),
    defaultTags: text().array().notNull().default(sql`'{}'::text[]`),
    defaultSource: text().notNull().default(""),
    totalRows: integer().notNull().default(0),
    rejectedInBrowser: jsonb().$type<Record<string, number>>(),
    status: text({ enum: ["running", "done"] }).notNull().default("running"),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.campaignId), index().on(t.createdBy), index().on(t.oneCallerId)],
);

/** One row per uploaded chunk: the primary key makes a retried chunk impossible to record twice. */
export const importChunks = pgTable(
  "import_chunks",
  {
    batchId: uuid().notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    index: integer().notNull(),
    created: integer().array().notNull(), // spreadsheet row numbers only
    skipped: integer().array().notNull(),
    invalid: integer().array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.index] })],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    campaignId: uuid().notNull().references(() => campaigns.id),
    name: text().notNull(),
    phone: text().notNull(), // normalized 07XXXXXXXX, see lib/phone.ts
    altPhone: text(),
    school: text().notNull().default(""),
    district: text().notNull().default(""),
    gradeOrBatch: text().notNull().default(""),
    source: text().notNull().default(""),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    notes: text().notNull().default(""),
    assignedTo: uuid().references(() => users.id),
    stage: text({ enum: STAGES }).notNull().default("new"),
    stageChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastCallAt: timestamp({ withTimezone: true }),
    lastOutcome: text({ enum: OUTCOMES }),
    nextCallbackAt: timestamp({ withTimezone: true }), // mirrors the pending callback
    lastWhatsappAt: timestamp({ withTimezone: true }),
    importBatchId: uuid().references(() => importBatches.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_campaign_phone_key").on(t.campaignId, t.phone),
    index().on(t.phone), // "already in another campaign" warning
    index().on(t.campaignId, t.assignedTo, t.stage),
    index().on(t.campaignId, t.createdAt),
    index().on(t.campaignId, t.assignedTo, t.nextCallbackAt),
    index().on(t.campaignId, t.assignedTo, t.lastCallAt),
    index().on(t.assignedTo),
    index().on(t.importBatchId),
    index("contacts_tags_idx").using("gin", t.tags),
    check("contacts_stage_check", oneOf("stage", STAGES)),
    check("contacts_last_outcome_check", sql`last_outcome is null or ${oneOf("last_outcome", OUTCOMES)}`),
  ],
);

/** Append-only call history. `undo` holds what the call changed, for the short undo window. */
export const calls = pgTable(
  "calls",
  {
    id: id(),
    campaignId: uuid().notNull().references(() => campaigns.id),
    contactId: uuid().notNull().references(() => contacts.id),
    callerId: uuid().notNull().references(() => users.id),
    calledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    outcome: text({ enum: OUTCOMES }).notNull(),
    durationSec: integer(),
    notes: text().notNull().default(""),
    undo: jsonb(),
  },
  (t) => [
    index().on(t.contactId, t.calledAt.desc()),
    index().on(t.campaignId, t.calledAt.desc()),
    index().on(t.callerId, t.calledAt.desc()),
    check("calls_outcome_check", oneOf("outcome", OUTCOMES)),
  ],
);

export type CallbackHistory = {
  at: string;
  by?: string;
  action: "created" | "rescheduled" | "done" | "cancelled" | "reopened";
  dueAt?: string;
  reason?: string;
}[];

export const callbacks = pgTable(
  "callbacks",
  {
    id: id(),
    campaignId: uuid().notNull().references(() => campaigns.id),
    contactId: uuid().notNull().references(() => contacts.id),
    callerId: uuid().references(() => users.id), // follows the contact's caller
    dueAt: timestamp({ withTimezone: true }).notNull(),
    note: text().notNull().default(""),
    status: text({ enum: ["pending", "done", "cancelled"] }).notNull().default("pending"),
    history: jsonb().$type<CallbackHistory>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one pending callback per contact.
    uniqueIndex("callbacks_one_pending_per_contact").on(t.contactId).where(sql`status = 'pending'`),
    index().on(t.callerId, t.status, t.dueAt),
    index().on(t.campaignId, t.status, t.dueAt),
    index().on(t.contactId),
    check("callbacks_status_check", sql`status in ('pending', 'done', 'cancelled')`),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: id(),
    name: text().notNull(),
    language: text({ enum: ["si", "en"] }).notNull(),
    body: text().notNull(), // placeholders: {name} {class} {fee} {start_date} {link} {caller}
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check("templates_language_check", sql`language in ('si', 'en')`)],
);

/** Logged when the caller confirms they sent a message. The app only opens WhatsApp; it never sends. */
export const whatsappLogs = pgTable(
  "whatsapp_logs",
  {
    id: id(),
    campaignId: uuid().notNull().references(() => campaigns.id),
    contactId: uuid().notNull().references(() => contacts.id),
    callerId: uuid().notNull().references(() => users.id),
    templateId: uuid().references(() => templates.id, { onDelete: "set null" }),
    templateName: text().notNull().default(""), // kept if the template is later deleted
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    note: text().notNull().default(""),
  },
  (t) => [
    index().on(t.contactId, t.sentAt.desc()),
    index().on(t.campaignId, t.sentAt.desc()),
    index().on(t.callerId),
    index().on(t.templateId),
  ],
);

/** Never put phone numbers or passwords in before/after. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(), // e.g. "user.create"
    entity: text().notNull(), // table name
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.at.desc()), index().on(t.action, t.at.desc()), index().on(t.entity, t.entityId, t.at.desc()), index().on(t.actorId)],
);

/** Fixed-window sign-in counters (see lib/rate-limit.ts). */
export const loginAttempts = pgTable("login_attempts", {
  key: text().primaryKey(),
  count: integer().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});
