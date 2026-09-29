# Deploying to Vercel + MongoDB Atlas

> **No budget?** Follow [deploy-free-netlify.md](deploy-free-netlify.md) instead. Netlify's free plan allows commercial use, and Vercel's free plan doesn't. The steps below are for when the class pays for **Vercel Pro**.

Nothing here has been deployed. Follow these steps when you're ready. The app needs no background workers, no cron jobs and no headless browser:

- anything time-based ("due", "overdue", "today") is worked out when a page loads;
- CSV files are read in the browser and uploaded in small chunks;
- exports are built in the browser from small pages of data.

## 0. Which Vercel plan?

Vercel's **Hobby (free) plan is for personal, non-commercial use only**. A class that charges fees and uses this app to enrol paying students is commercial use, so under Vercel's terms you need **Pro** (about US$20 per team member per month; only the person who manages deployments needs a seat, since callers just use the website). The app stays well within the free-tier *limits* either way. Check Vercel's current pricing page before deciding.

## 1. MongoDB Atlas (free M0 cluster)

1. Sign in at <https://cloud.mongodb.com>, create a project (e.g. "Call Campaign") and choose **Create cluster → M0 (Free)**.
   - Pick the region closest to Sri Lanka that M0 offers (AWS **Mumbai, ap-south-1** if listed, otherwise Singapore).
2. **Database Access → Add database user**:
   - Username: `callcampaign-app`. Password: use **Autogenerate** and copy it somewhere safe.
   - *Built-in role*: **Read and write to any database** is simplest. Stricter: *Specific privileges* → `readWrite` on the database `call-campaign` only.
3. **Network Access → Add IP address → `0.0.0.0/0`** ("allow access from anywhere").
   - Vercel functions don't have fixed IP addresses, so this is required on the free tier. The strong, app-only password from step 2 is what protects the data.
   - Alternative: install the **MongoDB Atlas integration** from the Vercel Marketplace. It creates the user, network access and the `MONGODB_URI` variable for you.
4. **Connect → Drivers** and copy the connection string. **Put the database name in the path**:
   ```
   mongodb+srv://callcampaign-app:<password>@<cluster>.mongodb.net/call-campaign?retryWrites=true&w=majority
   ```
   If the password contains special characters (`@ : / ? # %`), URL-encode them.

> The free M0 cluster has **no automatic backups**. Set up the routine in [backup.md](backup.md) before real data goes in.

## 2. Vercel project

1. Push the repository to GitHub (you do this yourself), then in Vercel choose **Add New → Project → import `Call-Campaign`**. The framework is detected as Next.js, so leave the build settings at their defaults.
2. **Settings → Environment Variables** (Production, and Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `MONGODB_URI` | the Atlas string from step 1.4 |
   | `AUTH_SECRET` | a new random secret: run `npx auth secret` or `openssl rand -base64 33`. Never reuse the development one. |

   Nothing else is needed. `NODE_ENV` and HTTPS are handled by Vercel.
3. **Settings → Functions → Function Region**: choose the region nearest your Atlas cluster (e.g. Mumbai `bom1` for ap-south-1). Keeping them close makes every page faster.
4. **Deploy.**

## 3. First owner account

From your computer, with the **production** `MONGODB_URI` in the environment (don't save it to `.env.local`):

```bash
MONGODB_URI="mongodb+srv://…/call-campaign?…" npm run create-owner -- "Pasindu Athukorala" you@example.lk
```

It prints a temporary password. Sign in at your Vercel URL with it; the app then asks you to choose your own password. Add callers from **Users**.

**Never run `npm run seed` against production.** It refuses anyway unless the database name ends in `-dev` or `-test`.

## 4. Domain (optional)

**Settings → Domains → Add** (e.g. `calls.yourclass.lk`), then add the DNS record Vercel shows at your domain registrar. HTTPS is automatic.

## 5. After deploying: quick checks

- Sign in as the owner. Create a campaign, add a caller and an active status, then import `docs/sample-contacts.csv` into a **test** campaign. Delete that campaign's contacts afterwards, or keep test data in a separate `-test` database.
- On a phone, sign in as the caller and check that **Start calling → Call** opens the dialler and **WhatsApp** opens WhatsApp.
- Check **Audit log** shows the import.

## Limits that matter

| Limit | How the app stays inside it |
| --- | --- |
| Request body ~4.5 MB (Vercel); server actions accept 1 MB by default | Import chunks are at most 250 rows and ~700 KB |
| Function duration | Each chunk and page is one short query (measured locally: ≤ 30 ms per 250-row chunk, ~50 ms per 2,000-row export page) |
| Atlas M0: 512 MB storage, shared CPU, ~500 connections | The connection is reused across requests (`lib/db.ts`, pool of 5). See [data-model.md](data-model.md) for size estimates |
| No always-on workers on Vercel | Nothing needs one; no cron job is configured |

## Updating

Push to `main`, and Vercel builds and deploys it. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the build and the Playwright tests on every push and pull request. You can make Vercel wait for CI under **Settings → Git → Ignored Build Step**, or with branch protection.
