# Going live for free: Netlify + MongoDB Atlas

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

## 2. MongoDB Atlas (free M0 database)

1. Go to <https://cloud.mongodb.com> and sign up. Create a project, then **Create → M0 Free**.
   - **Provider AWS, region Ohio (us-east-2)** if it's offered, otherwise **N. Virginia (us-east-1)**.
   - *Why the USA?* Netlify's free plan runs the app's server code in Ohio, and each page runs several database queries. Keeping the database next to that server code makes pages load fast from Sri Lanka. A database in Mumbai would add a slow round trip to every single query.
2. **Database Access → Add New Database User.**
   - Username `callcampaign-app`. Click **Autogenerate Secure Password** and copy it somewhere safe.
   - Role: **Read and write to any database**.
3. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`).**
   - Netlify's servers don't have a fixed IP, so this is required. The long random password is what protects the data.
4. **Database → Connect → Drivers** and copy the connection string. Add the database name `call-campaign` before the `?`:
   ```
   mongodb+srv://callcampaign-app:<password>@<your-cluster>.mongodb.net/call-campaign?retryWrites=true&w=majority
   ```
   If the password has any of `@ : / ? # %`, generate a new one without them. That's easier than encoding them.

## 3. Netlify

1. Go to <https://app.netlify.com> and **sign up with GitHub**.
2. **Add new project → Import an existing project → GitHub →** pick `Call-Campaign`.
   - Netlify detects Next.js. Leave the build command (`npm run build`) and other settings as they are.
3. **Before the first deploy**, open **Environment variables** (on the import screen, or later under *Project configuration → Environment variables*) and add:

   | Key | Value |
   | --- | --- |
   | `MONGODB_URI` | the Atlas string from step 2.4 |
   | `AUTH_SECRET` | a **new** secret. On your computer run `npx auth secret` (or `openssl rand -base64 33`) and paste what it prints. Don't reuse the one in `.env.local`. |

4. Click **Deploy**. After 2–4 minutes you get a web address like `https://call-campaign-xyz.netlify.app`.
   - You can rename it under *Project configuration → Change project name*, e.g. `pa-ict-calls.netlify.app`.

## 4. Create your owner account

On your computer, in the project folder, run this with the **live** connection string. Type it in the command; **don't** put it in `.env.local`:

```bash
MONGODB_URI="mongodb+srv://callcampaign-app:…/call-campaign?retryWrites=true&w=majority" npm run create-owner -- "Your Name" you@example.com
```

1. It prints a temporary password. Open your Netlify address, sign in with it, and choose your own password.
2. **Users → Add user** for each caller. Share their temporary password privately.
3. **Campaigns → New campaign.** Set it to *Active* and tick the callers.
4. **Contacts → Import CSV.**
5. **Templates:** add your real WhatsApp messages.

Never run `npm run seed` on the live database. It refuses anyway, because the database name doesn't end in `-dev`.

## 5. Save credits: control when the live site updates

A deploy happens every time you push to `main`, and each one costs 15 credits. So:

- **Work on another branch** (e.g. `dev`). Netlify builds pushes to other branches as **deploy previews for 0 credits**. You get a separate preview link to check changes.
- **Merge `dev` → `main` only when you want the live site updated.** Once or twice a week is plenty.
- To pause live deploys completely, go to *Project configuration → Build & deploy → Continuous deployment → Build settings → **Stop builds***. Turn it back on when you're ready.

Check usage any time under **Team → Usage / Billing**.

## 6. Checks after going live

- Sign in on a caller's **phone**. **Start calling → Call** should open the dialler, and **WhatsApp** should open WhatsApp with the message.
- Import a small test file first, e.g. `docs/sample-contacts.csv`, into a *test* campaign, then delete that campaign's contacts or keep it as a draft.
- Set up the backup routine in [backup.md](backup.md). **The free Atlas cluster has no automatic backups.**

## If you outgrow the free plan

Signs you've outgrown it: the site got paused, or Netlify emails say you're at 75% early in the month. That means the class is getting real use. Since the class earns fees, it's reasonable to ask for a paid plan, either Netlify's paid tier or Vercel Pro. **Nothing in the app needs to change**: add the same two environment variables on the new host and point your domain at it.

## Other free options (and why they're second choice)

- **Render (free web service):** runs the app as a normal Node server. It **sleeps after 15 minutes without visitors** and takes about a minute to wake up, which is frustrating for callers starting their shift. Check Render's current terms for commercial use before relying on it.
- **Vercel Hobby:** technically works, but this is commercial use, which its terms don't allow. The site could be paused without warning.
