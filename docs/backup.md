# Backups and exports

Don't rely on the Supabase free plan for backups. Use both routines below.

## Weekly: Excel exports (5 minutes, no tools)

As the owner, for each active campaign: **Contacts → Export**, then download each of these as **Excel**:

1. Contacts
2. Call log
3. WhatsApp log
4. Callbacks
5. Per-caller performance

Clear any filters first so the exports include everything. Save the files in a dated folder (e.g. `Backups/2026-10-05/`) somewhere private.

These files are for people to read and keep as a record. Contacts can be re-imported from the contacts file, but call history and logs can't be restored from Excel.

## Weekly or monthly: full database copy (`pg_dump`)

This is the real backup, and it can be restored completely.

1. Install the PostgreSQL client tools, version 17 to match Supabase (on a Mac: `brew install postgresql@17`).
2. In Supabase, open **Connect** and copy the **Session pooler** connection string (port 5432). It works on IPv4 networks, unlike the direct connection.
3. Make the backup:
   ```bash
   pg_dump "postgresql://postgres.<ref>:<password>@<host>:5432/postgres" \
     --schema=public --no-owner --format=custom --file="call-campaign-$(date +%F).dump"
   ```
4. Keep the `.dump` file somewhere private. **It contains students' phone numbers.**
5. To restore (e.g. into a new Supabase project), apply the schema first with `npm run db:migrate`, then load the data:
   ```bash
   pg_restore --data-only --no-owner --disable-triggers \
     --dbname="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" call-campaign-2026-10-05.dump
   ```
   Test a restore once into a spare project, so you know it works before you need it.

## Retention

When an intake ends, set the campaign to **Ended** and take a final export and dump.

If a student or parent asks for their number to be removed, find the contact and set their stage to **Do not contact**, or delete the contact in Supabase's table editor.
