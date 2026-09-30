# Permissions

Every page and server action checks the signed-in user **on the server**, through `requireUser()` / `requireOwner()` in `lib/session.ts`. Those functions re-read the user from the database on every request. The role, the active flag and the session version therefore never come from the browser. A caller who types another caller's contact id into a request gets "not found".

Contact queries all go through `contactFilter()` in `lib/contacts-query.ts`, which forces `assignedTo = me` for callers.

| Area | Owner | Caller |
| --- | --- | --- |
| Dashboard, pipeline, audit log | ✅ | — |
| Campaigns: create, edit, duplicate | ✅ | — |
| Users: add, deactivate, reset password | ✅ (not their own account) | — |
| WhatsApp templates: manage | ✅ | use only |
| Contacts: see | all | **only contacts assigned to them** |
| Contacts: add manually | any campaign, assign to any caller on it | campaigns they're on; always assigned to themselves |
| Contacts: edit details, change stage (incl. enrolled, with confirmation) | ✅ | own contacts |
| Contacts: reassign, bulk actions, import CSV | ✅ | — |
| **Exports** (contacts, calls, WhatsApp, callbacks, performance) | ✅ | — |
| Calling mode, Today, WhatsApp page | ✅ (their own assigned contacts) | ✅ |
| Log calls, undo own call within 10 s | ✅ | own contacts |
| Callbacks: reschedule, complete, cancel | all | their own |
| Change own password | ✅ | ✅ |

## Recorded in the audit log

- **Users:** created, activated, deactivated, password reset, password changed.
- **Campaigns:** created, edited, duplicated.
- **Contacts:** every stage change (manual, bulk, pipeline, from a call, from an undo) and every reassignment.
- **Imports:** start and finish, with counts.
- **Exports:** every export, with type, format, row count and filters.
- **Templates:** created, edited, deleted.
- **Calls:** undone calls.

## Sessions and sign-in

- **Session cookie:** httpOnly, SameSite=Lax, and secure on HTTPS. It expires after 12 hours.
- **Rate limit:** 5 attempts per email and 30 per IP address every 15 minutes (stored in PostgreSQL).
- **Temporary passwords** are shown once. The user must replace one at first sign-in.
- **Deactivating a user** or **resetting their password** signs them out on every device immediately.

## Database access

The app connects to PostgreSQL from the server only. Every table has row-level security switched on with no policies, and the `anon` / `authenticated` roles have no grants, so Supabase's public Data API can't read or change anything. All access rules live in the server code above.
