# Call Campaign

Calling and WhatsApp follow-up for the Pasindu Athukorala ICT class. Next.js (App Router) on Vercel, with MongoDB Atlas.

- **Owner:** dashboard, pipeline board, campaigns, CSV import (chunked, retry-safe), CSV/Excel exports, users, WhatsApp templates, audit log.
- **Callers (phone-first):** Today, calling mode (one contact at a time, one-tap outcomes, undo, keyboard shortcuts), WhatsApp with templates, callbacks, my contacts.

## Local setup

Needs Node 22 or newer. You don't need to install MongoDB or Docker.

```bash
npm install
cp .env.example .env.local        # then set AUTH_SECRET: npx auth secret
npm run db:dev                    # terminal 1: local MongoDB on :27017, data kept in .dev-db/
npm run seed                      # FICTIONAL users; only runs on *-dev / *-test databases
npm run dev                       # terminal 2: http://localhost:3000
```

The seed adds fictional users `owner@example.test`, `nimali@example.test` and `kasun@example.test`, all with the password `fictional-dev-pw`. It also adds a campaign with 60 fictional contacts, 6 WhatsApp templates marked TEST (English and Sinhala) and two callbacks. Running it again only adds what's missing.

To create the first real owner on any database (including production):

```bash
npm run create-owner -- "Full Name" owner@yourdomain.lk
```

This prints a temporary password. The owner has to change it at first sign-in.

## Environment variables

| Name          | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `MONGODB_URI` | Connection string. Put the database name in the path, e.g. `/call-campaign` |
| `AUTH_SECRET` | Signs session cookies. Generate one with `npx auth secret`              |

## Scripts

| Command              | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `npm run dev`        | Dev server                                                            |
| `npm run lint`       | ESLint                                                                |
| `npm run typecheck`  | TypeScript (strict)                                                   |
| `npm test`           | Vitest unit/API tests (uses a throwaway in-memory MongoDB)            |
| `npm run test:e2e`   | Playwright, desktop + Pixel 7. Run `npm run build` first; it starts its own DB and server on :3100 |
| `npm run db:dev`     | Local MongoDB for development                                         |
| `npm run seed`       | Fictional dev data (refuses to run unless the database name ends in `-dev` or `-test`) |
| `npm run create-owner` | Creates an owner account                                            |

First-time Playwright setup: `npx playwright install chromium`.

The Playwright suite includes an automated accessibility check (axe, WCAG 2.1 AA, serious and critical issues) and a check that no page scrolls sideways, on desktop and on a Pixel 7.

## Docs

- [Going live for free: Netlify + MongoDB Atlas](docs/deploy-free-netlify.md), recommended while there's no budget
- [Deploying to Vercel + MongoDB Atlas](docs/deployment.md), for when the class pays for Vercel Pro
- [Data model](docs/data-model.md)
- [Permissions](docs/permissions.md): who can do what, and what's audited
- [CSV import and export](docs/csv-format.md), with a fictional [sample file](docs/sample-contacts.csv)
- [Backups and exports](docs/backup.md)
- [Caller guide](docs/caller-guide.md): share this with callers

## How auth works

- Sign-in uses Auth.js credentials with bcrypt. Sessions are JWT cookies (httpOnly, SameSite=Lax, secure over HTTPS) and last 12 hours.
- Every page and server action calls `requireUser()` or `requireOwner()` in `lib/session.ts`. These re-read the user from the database, so the role, the active flag and the token version are never taken from the browser.
- When the owner deactivates a user or resets their password, the user's `tokenVersion` goes up, which signs them out on every device.
- Sign-in attempts are rate-limited in MongoDB: 5 per email and 30 per IP every 15 minutes.
- New and reset users must choose their own password before using the app.
