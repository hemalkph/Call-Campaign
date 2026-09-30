# Data model

PostgreSQL (Supabase in production, PGlite locally and in tests), accessed with Drizzle ORM.

- **Tables:** defined in `lib/db/schema.ts`. `npm run db:generate` turns schema changes into SQL migrations in `drizzle/`, and `npm run db:migrate` applies them.
- **Naming:** columns are `snake_case` in the database and `camelCase` in code.
- **IDs:** time-ordered UUIDs (v7).
- **Times:** stored as `timestamptz` (UTC). "Today", "overdue" and daily buckets use Asia/Colombo time (`lib/time.ts`, and `at time zone 'Asia/Colombo'` in SQL). Campaign start and end are `date` columns.

| Table | What it holds | Rules the database enforces |
| --- | --- | --- |
| `users` | name, email, bcrypt `password_hash`, `role` (owner/caller), `active`, phone, `must_change_password`, `token_version` | unique email. `token_version` goes up on password reset or deactivation, which invalidates old sessions. |
| `campaigns` | name, class/intake, start/end date, status (draft/active/ended), daily call target, enrollment target, script, fee, link | status values; end date ≥ start date |
| `campaign_callers` | which callers work a campaign, their own daily target (optional), display order | primary key (campaign, user) |
| `contacts` | campaign, name, **phone (normalized `07XXXXXXXX`)**, parent phone, school, district, grade/batch, source, `tags text[]`, notes, assigned caller, **stage**, stage changed at, last call / outcome, next callback, last WhatsApp, import batch | **unique (campaign, phone)**; valid stage and outcome values. Indexes for lists, "next contact", search by phone and tags (GIN). |
| `calls` | campaign, contact, caller, called at, outcome, duration, notes, `undo` (jsonb: what the call changed, for the 10-second undo) | append-only; valid outcomes |
| `callbacks` | campaign, contact, caller (follows the contact's caller), due at, note, status, `history` (jsonb) | **at most one pending callback per contact** (partial unique index `where status = 'pending'`). `contacts.next_callback_at` mirrors it. |
| `whatsapp_logs` | campaign, contact, caller, template, template name, sent at | written only when the caller confirms they sent the message |
| `templates` | name, language (si/en), body with `{name} {class} {fee} {start_date} {link} {caller}` | language values |
| `import_batches` | idempotency key, campaign, file name, column mapping, assignment settings, status | unique key |
| `import_chunks` | per chunk: row numbers created / skipped / invalid | **primary key (batch, chunk number)**, so a retried chunk can never be recorded twice. **No names or phones**: only row numbers. |
| `audit_events` | actor, action, entity, entity id, before/after (jsonb), at | **no phone numbers or passwords**. Search text is never stored. |
| `login_attempts` | hashed email or IP key, count, window end | one row per key, updated atomically |

Every table has **row-level security enabled with no policies**, and the `anon` / `authenticated` roles have no grants (`drizzle/0001_lock_down.sql`). The app connects as `postgres` from the server, so Supabase's public Data API can't read or change anything. **Any new table must get the same treatment.**

## Stages

`new → contacted → interested → payment_details_sent → enrolled`, plus the closed stages `not_interested`, `wrong_number` and `do_not_contact`.

A logged call only moves a contact forward (`lib/calling.ts → stageAfter`). Logging a call is a single transaction covering the call, the contact, the callback and the audit entry: either all of it is saved, or none of it.

## Size on Supabase's free plan (500 MB database)

A contact is about 0.5–1 KB with its indexes, and a call or log about 0.3 KB. That's roughly 100,000 contacts plus a few hundred thousand calls before 500 MB gets tight. Check **Supabase → Reports → Database** for current size.
