# Going live for free: Netlify + Supabase

Total cost: **Rs. 0**. No credit card is needed for either service.

## Why Netlify and not Vercel?

- **Vercel's free Hobby plan is for non-commercial use only.** Vercel counts a project as commercial if it earns money for anyone involved, and a class that charges fees does, even if the person building it is a student. The free plan that fits is **Netlify's**.
- **Netlify's free plan allows commercial projects** and supports Next.js 16, including server actions, through its automatic Next.js adapter.
- **The catch:** the free plan has a **hard budget of 300 credits per month**. If it runs out, **the site is paused until the next month**; you can't buy more credits on the free plan. Netlify emails you at 50%, 75% and 100%.

| Netlify usage | Credits |
| --- | --- |
| **Each production deploy** (publishing to the live site) | **15** |
| Server compute | 10 per GB-hour |
| Bandwidth | 20 per GB |
| Page requests | 2 per 10,000 |
| Deploy previews / branch deploys, failed deploys | 0 |

**Rough budget for this app with ~5 callers:** about 30,000–50,000 requests a month.

| What | Credits a month |
| --- | --- |
| Compute (short requests) | ~20–45 |
| Requests | ~10 |
| Bandwidth (1–2 GB) | ~20–40 |
| **Running total** | **~50–100** |
| Deploys (the rest of the budget) | at most ~10 |

**The main rule: don't deploy on every small change** (see step 5).

## 1. Put the code on GitHub

You commit and push yourself. Keep `.env.local` out of Git (it's in `.gitignore`).

```bash
git add .
git commit -m "Call Campaign v1"
git push -u origin main
```

A private repository is fine.

## 2. Supabase (free PostgreSQL database)

1. At <https://supabase.com/dashboard>, create a project.
   - **Region: East US (Ohio)**. Netlify's free plan runs the app's server code in Ohio, and each page runs several database queries, so keeping the database next to it keeps pages fast from Sri Lanka. A database in Sydney or Mumbai adds a slow round trip to *every* query.
   - Let Supabase generate the database password and save it in a password manager.
   - The region can't be changed later. If a project is in the wrong region, make a new one.
2. Open **Connect** (top of the project page) and copy two connection strings, putting your password in each:
   - **Transaction pooler** (port **6543**). The app uses this one.
   - **Session pooler** (port **5432**). Used from your computer for migrations and backups.
3. Create the tables. On your computer, in the project folder, run this with the **Session pooler** string. Type it in the command; don't save it in `.env.local`:
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" npm run db:migrate
   ```
   This creates all tables and indexes, turns on row-level security, and blocks Supabase's public Data API from them. The app talks to the database directly from the server.
4. Optional: **Advisors → Security Advisor** in Supabase will list the tables as "RLS enabled, no policy". That's intentional: nobody reaches them through the Data API.

> **Free-plan notes:**
> - Supabase pauses free projects after about a week with no activity. Daily use keeps it awake, and you can restore a paused project from the dashboard.
> - Don't rely on the free plan for backups. Set up [backup.md](backup.md) before real data goes in.

## 3. Netlify

1. Go to <https://app.netlify.com> and **sign up with GitHub**.
2. **Add new project → Import an existing project → GitHub →** pick `Call-Campaign`.
   - Netlify detects Next.js. Leave the build command (`npm run build`) and other settings as they are.
3. **Before the first deploy**, open **Environment variables** (on the import screen, or later under *Project configuration → Environment variables*) and add:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the **Transaction pooler** string from step 2.2 (port 6543) |
   | `AUTH_SECRET` | a **new** secret. On your computer run `npx auth secret` (or `openssl rand -base64 33`) and paste what it prints. Don't reuse the one in `.env.local`. |

4. Click **Deploy**. After 2–4 minutes you get a web address like `https://call-campaign-xyz.netlify.app`.
   - You can rename it under *Project configuration → Change project name*, e.g. `pa-ict-calls.netlify.app`.

## 4. Create your owner account

On your computer, in the project folder, run this with the **Session pooler** string. Type it in the command; **don't** put it in `.env.local`:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" npm run create-owner -- "Your Name" you@example.com
```

1. It prints a temporary password. Open your Netlify address, sign in with it, and choose your own password.
2. **Users → Add user** for each caller. Share their temporary password privately.
3. **Campaigns → New campaign.** Set it to *Active* and tick the callers.
4. **Contacts → Import CSV.**
5. **Templates:** add your real WhatsApp messages.

Never run `npm run seed` on the live database. It refuses anyway: it only runs against a database on your own computer.

## 5. Save credits: control when the live site updates

A deploy happens every time you push to `main`, and each one costs 15 credits. So:

- **Work on another branch** (e.g. `dev`). Netlify builds pushes to other branches as **deploy previews for 0 credits**. You get a separate preview link to check changes.
- **Merge `dev` → `main` only when you want the live site updated.** Once or twice a week is plenty.
- To pause live deploys completely, go to *Project configuration → Build & deploy → Continuous deployment → Build settings → **Stop builds***. Turn it back on when you're ready.

Check usage any time under **Team → Usage / Billing**.

## 6. Checks after going live

- Sign in on a caller's **phone**. **Start calling → Call** should open the dialler, and **WhatsApp** should open WhatsApp with the message.
- Import a small test file first, e.g. `docs/sample-contacts.csv`, into a *test* campaign, then delete that campaign's contacts or keep it as a draft.
- Set up the backup routine in [backup.md](backup.md). **Don't rely on the free plan for backups.**

## If you outgrow the free plan

Signs you've outgrown it: the site got paused, or Netlify emails say you're at 75% early in the month. That means the class is getting real use. Since the class earns fees, it's reasonable to ask for a paid plan, either Netlify's paid tier or Vercel Pro. **Nothing in the app needs to change**: add the same two environment variables on the new host and point your domain at it.

**Changing the database later:** edit `lib/db/schema.ts`, run `npm run db:generate` to create a migration in `drizzle/`, commit it, and run `npm run db:migrate` against Supabase (Session pooler string) before deploying. Any new table needs RLS switched on like the existing ones; see `drizzle/0001_lock_down.sql`.

## Other free options (and why they're second choice)

- **Render (free web service):** runs the app as a normal Node server. It **sleeps after 15 minutes without visitors** and takes about a minute to wake up, which is frustrating for callers starting their shift. Check Render's current terms for commercial use before relying on it.
- **Vercel Hobby:** technically works, but this is commercial use, which its terms don't allow. The site could be paused without warning.
