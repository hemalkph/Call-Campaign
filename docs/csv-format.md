# CSV import and export

## Importing contacts

Open **Contacts** and pick the campaign, then choose **Import CSV**. A sample file is in [`sample-contacts.csv`](sample-contacts.csv). All its data is fictional, and it includes a duplicate, a missing name and an invalid phone so you can see how they are handled.

### File requirements

- Save the file as **CSV UTF-8** (in Excel: *File → Save As → CSV UTF-8 (Comma delimited)*). Files with or without a BOM both work.
- The first row must be the header. Header names can be English or Sinhala, because you match the columns in the wizard.
- A file can have up to 20,000 rows. Split bigger files.

### Columns

| Field | Required | Notes |
| --- | --- | --- |
| Name | yes | |
| Phone | yes | Any Sri Lankan format works: `0712345678`, `712345678` (Excel dropped the 0), `+94 71 234 5678`, `94712345678`, `071-234-5678`. Everything is stored as `0712345678`. |
| Parent's phone | no | Dropped (not rejected) if it isn't a valid number. |
| School, District, Grade / batch, Source, Notes | no | District names are matched to the 25 districts ignoring case, e.g. `kandy` becomes `Kandy`. |
| Tags | no | Separate tags with `,` `;` or `\|`. |

The wizard guesses the matching columns from headers such as *Name / Student / නම*, *Phone / Mobile / WhatsApp / දුරකථන*, *Parent / Guardian / දෙමාපිය*, *School / පාසල* and *District / දිස්ත්‍රික්*.

### What happens to each row

| Status | Meaning |
| --- | --- |
| New | Imported. |
| Duplicate in file | The same phone appears in an earlier row; only the first one is imported. |
| Already in campaign | That phone is already a contact in this campaign; it's skipped and not changed. |
| Invalid phone / Missing name | Not imported. |

After the import you can **download the rejected rows** as a CSV. It keeps your original columns and adds *Row* and *Reason* columns, so you can fix those rows and import them again.

### Assignment

- **Balanced** (default): each new contact goes to the caller with the fewest open contacts. Enrolled, not interested, wrong number and do-not-contact don't count as open.
- **Round-robin**: callers take turns in file order.
- **All to one caller**, or **leave unassigned**.

Only active callers on the campaign are used.

### Large files and bad connections

The file is read in your browser and sent in chunks of up to 250 rows. If the connection drops, the import pauses and you can **Resume** it. A chunk that already reached the server is never imported twice, and re-importing the same file skips every phone that's already there.

## Exporting

On **Contacts**, choose **Export** and then **Excel (.xlsx)** or **CSV**. Only owners can export. The export includes every contact that matches the current search and filters, across all pages, not just the visible page. Each export is recorded in the audit log.

- **Excel (.xlsx)** stores phone numbers as text, so the leading `0` is kept.
- **CSV** is UTF-8 with a BOM, so Excel shows Sinhala correctly. Any cell starting with `=`, `+`, `-` or `@` gets a `'` in front so spreadsheet programs don't run it as a formula.
  - Excel removes the leading `0` from phone numbers when it *opens* a CSV. Use the Excel export if you need to read numbers in Excel. Re-importing such a CSV is fine, because the import puts the 0 back.
