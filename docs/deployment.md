# Deploying to Vercel + Supabase

> **No budget?** Follow [deploy-free-netlify.md](deploy-free-netlify.md) instead. Netlify's free plan allows commercial use, and Vercel's free plan doesn't. The steps below are for when the class pays for **Vercel Pro**.

Nothing here has been deployed. Follow these steps when you're ready. The app needs no background workers, no cron jobs and no headless browser:

- anything time-based ("due", "overdue", "today") is worked out when a page loads;
- CSV files are read in the browser and uploaded in small chunks;
- exports are built in the browser from small pages of data.

## 0. Which Vercel plan?

Vercel's **Hobby (free) plan is for personal, non-commercial use only**. A class that charges fees and uses this app to enrol paying students is commercial use, so under Vercel's terms you need **Pro** (about US$20 per team member per month; only the person who manages deployments needs a seat, since callers just use the website). The app stays well within the free-tier *limits* either way. Check Vercel's current pricing page before deciding.

## 1. Supabase (PostgreSQL)

Follow **step 2 of [deploy-free-netlify.md](deploy-free-netlify.md)**: create the project, copy the Transaction pooler (port 6543) and Session pooler (port 5432) strings, and run `npm run db:migrate` with the Session pooler string.

The one difference is the region: pick the Supabase region you'll also choose for Vercel's functions in step 2.3 (e.g. **Southeast Asia (Singapore)** with Vercel `sin1`, or **South Asia (Mumbai)** with `bom1`). The database and the server code must sit in the same region.

## 2. Vercel project

1. Push the repository to GitHub (you do this yourself), then in Vercel choose **Add New → Project → import `Call-Campaign`**. The framework is detected as Next.js, so leave the build settings at their defaults.
2. **Settings → Environment Variables** (Production, and Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase **Transaction pooler** string (port 6543) |
   | `AUTH_SECRET` | a new random secret: run `npx auth secret` or `openssl rand -base64 33`. Never reuse the development one. |

   Nothing else is needed. `NODE_ENV` and HTTPS are handled by Vercel.
3. **Settings → Functions → Function Region**: the same region as your Supabase project (e.g. `sin1` for Singapore, `bom1` for Mumbai). Keeping them together makes every page faster.
4. **Deploy.**

## 3. First owner account

From your computer, with the Supabase **Session pooler** string in the environment (don't save it to `.env.local`):

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" npm run create-owner -- "Pasindu Athukorala" you@example.lk
```

It prints a temporary password. Sign in at your Vercel URL with it; the app then asks you to choose your own password. Add callers from **Users**.

**Never run `npm run seed` against production.** It refuses anyway: it only runs against a database on your own computer.

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
| Supabase free: 500 MB database, limited connections | Connections go through Supabase's transaction pooler, and each server instance keeps a pool of 3 (`lib/db/index.ts`). See [data-model.md](data-model.md) for size estimates |
| No always-on workers on Vercel | Nothing needs one; no cron job is configured |

## Updating

Push to `main`, and Vercel builds and deploys it. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the build and the Playwright tests on every push and pull request. You can make Vercel wait for CI under **Settings → Git → Ignored Build Step**, or with branch protection.
