# Backups and exports

The free MongoDB Atlas M0 cluster **does not take backups**, so use both of the routines below.

## Weekly: Excel exports (5 minutes, no tools)

As the owner, for each active campaign: **Contacts → Export**, then download each of these as **Excel**:

1. Contacts
2. Call log
3. WhatsApp log
4. Callbacks
5. Per-caller performance

Clear any filters first so the exports include everything. Save the files in a dated folder (e.g. `Backups/2026-10-05/`) somewhere safe, such as a private Google Drive folder.

These files are for people to read and keep as a record. Contacts can be re-imported from the contacts file, but call history and logs can't be restored from Excel.

## Weekly or monthly: full database copy (`mongodump`)

This is the real backup, and it can be restored completely.

1. Install the [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) (on a Mac: `brew install mongodb-database-tools`).
2. Make the backup:
   ```bash
   mongodump --uri="mongodb+srv://…/call-campaign?…" --gzip --archive="call-campaign-$(date +%F).gz"
   ```
3. Keep the `.gz` file somewhere private. **It contains students' phone numbers.**
4. To restore (e.g. into a new cluster), run:
   ```bash
   mongorestore --uri="mongodb+srv://…/call-campaign?…" --gzip --archive=call-campaign-2026-10-05.gz --drop
   ```
   `--drop` replaces what's there. Test a restore into a separate `call-campaign-test` database once, so you know it works.

## Retention

When an intake ends, set the campaign to **Ended** and take a final export and dump.

If a student or parent asks for their number to be removed, find the contact and set their stage to **Do not contact**, or delete them from the database.
