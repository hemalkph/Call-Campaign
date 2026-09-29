# Data model

MongoDB, via Mongoose. Each collection's schema and indexes are declared in `lib/models/*.ts`. Mongoose builds any missing indexes when the app starts.

- **Times:** timestamps are stored in UTC. Anything that depends on "today" is worked out at read time in Asia/Colombo time (`lib/time.ts`).
- **Dates:** campaign start and end dates are stored as calendar dates (`YYYY-MM-DD`).

| Collection | What it holds | Key rules / indexes |
| --- | --- | --- |
| `users` | name, email, bcrypt `passwordHash`, `role` (owner/caller), `active`, `phone`, `mustChangePassword`, `tokenVersion` | email unique. `tokenVersion` goes up on password reset or deactivation, which invalidates old sessions. |
| `campaigns` | name, class/intake, start/end date, status (draft/active/ended), daily call target, enrollment target, script, fee, link, `callers[{userId, dailyCallTarget?}]` | `callers.userId` |
| `contacts` | campaignId, name, **phone (normalized `07XXXXXXXX`)**, altPhone, school, district, grade/batch, source, tags, notes, assignedTo, **stage**, stageChangedAt, lastCallAt, lastOutcome, nextCallbackAt, lastWhatsappAt, importBatchId | **`{campaignId, phone}` unique**. `phone` for the "in another campaign" warning. `{campaignId, assignedTo, stage / nextCallbackAt / lastCallAt}` for lists and "next contact". |
| `calls` | campaignId, contactId, callerId, calledAt, outcome, durationSec, notes, `undo` (hidden: what the call changed, used for the 10-second undo) | Append-only. Indexed by contact, campaign and caller, each with date. |
| `callbacks` | campaignId, contactId, callerId (follows the contact's caller), dueAt, note, status (pending/done/cancelled), `history[]` | **At most one pending callback per contact** (partial unique index on `contactId` where `status: "pending"`). `contacts.nextCallbackAt` mirrors the pending one. |
| `whatsappLogs` | campaignId, contactId, callerId, templateId, templateName, sentAt, note | Logged only when the caller confirms they sent the message. The app never sends messages itself. |
| `templates` | name, language (si/en), body with `{name} {class} {fee} {start_date} {link} {caller}` | |
| `importBatches` | idempotency key, campaign, file name, column mapping, assignment settings, per-chunk row numbers (created / skipped / invalid), status | `key` unique. **No names or phones**: only row numbers. |
| `auditEvents` | actorId, action, entity, entityId, before/after, at | **No phone numbers or passwords.** Search text is never stored, since it might be a phone number. |
| `loginAttempts` | hashed email or IP key, count, expiresAt | TTL index removes expired windows automatically. |

## Stages

`new → contacted → interested → payment_details_sent → enrolled`, plus the closed stages `not_interested`, `wrong_number` and `do_not_contact`.

A logged call can only move a contact forward (`lib/calling.ts → stageAfter`):

- *answered / callback requested* move a new contact to contacted.
- *interested / will enroll* move it to interested.
- *not interested / wrong number* set that stage.
- No outcome ever changes *enrolled* or *do not contact*.
- *no answer, busy, switched off* change nothing.

## Size on MongoDB Atlas M0 (free, 512 MB)

A contact is about 0.5–1 KB and a call or log about 0.3 KB. That's roughly 100,000 contacts plus a few hundred thousand calls before the 512 MB free tier becomes tight. The dashboard shows totals, so you'll see growth coming.
