// FICTIONAL development data. Refuses to run unless the database is on this computer.
import "./env.mts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { callbacks, campaignCallers, campaigns, contacts, templates, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";
import { STAGES } from "@/lib/vocab";

const url = new URL(process.env.DATABASE_URL ?? "postgres://missing");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || process.env.NODE_ENV === "production") {
  console.error(`Refusing to seed ${url.hostname}. Seeding only runs against a local database (npm run db:dev).`);
  process.exit(1);
}

const PASSWORD = "fictional-dev-pw";
const people = [
  { name: "Test Owner (FICTIONAL)", email: "owner@example.test", role: "owner" },
  { name: "Nimali Test (FICTIONAL)", email: "nimali@example.test", role: "caller", phone: "0710000001" },
  { name: "Kasun Test (FICTIONAL)", email: "kasun@example.test", role: "caller", phone: "0770000002" },
] as const;

const passwordHash = await hashPassword(PASSWORD);
await db
  .insert(users)
  .values(people.map((u) => ({ ...u, passwordHash, mustChangePassword: false })))
  .onConflictDoNothing({ target: users.email });
const byEmail = (email: string) => db.select().from(users).where(eq(users.email, email)).then((r) => r[0]);
const nimali = await byEmail("nimali@example.test");
const kasun = await byEmail("kasun@example.test");

const CAMPAIGN = "October intake (FICTIONAL)";
let [campaign] = await db.select().from(campaigns).where(eq(campaigns.name, CAMPAIGN));
if (!campaign) {
  [campaign] = await db
    .insert(campaigns)
    .values({
      name: CAMPAIGN,
      classLabel: "2027 A/L Theory",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      status: "active",
      dailyCallTarget: 40,
      enrollmentTarget: 25,
      script: "Hello, this is {caller} from Pasindu Athukorala ICT class. (FICTIONAL script)",
      fee: "Rs. 2,500 / month (FICTIONAL)",
      link: "https://example.test/join",
    })
    .returning();
  await db.insert(campaignCallers).values([
    { campaignId: campaign.id, userId: nimali.id, position: 0 },
    { campaignId: campaign.id, userId: kasun.id, dailyCallTarget: 30, position: 1 },
  ]);
}

const schools = ["Test College A", "Test Vidyalaya B", "Sample MV C"];
const districts = ["Colombo", "Gampaha", "Kandy", "Galle", "Kurunegala"];
await db
  .insert(contacts)
  .values(
    Array.from({ length: 60 }, (_, i) => ({
      campaignId: campaign.id,
      phone: `07100${String(i).padStart(5, "0")}`,
      name: `Test Student ${String(i + 1).padStart(2, "0")} (FICTIONAL)`,
      school: schools[i % 3],
      district: districts[i % 5],
      gradeOrBatch: "2027 A/L",
      source: i % 2 ? "Facebook ad" : "Seminar",
      tags: i % 7 === 0 ? ["revision"] : [],
      assignedTo: i % 10 === 9 ? null : i % 2 ? nimali.id : kasun.id,
      stage: STAGES[i % 5 === 0 ? i % STAGES.length : 0],
      // Spread creation times so "oldest first" orders are stable and realistic.
      createdAt: new Date(Date.UTC(2026, 8, 1) + i * 60_000),
    })),
  )
  .onConflictDoNothing({ target: [contacts.campaignId, contacts.phone] });

const texts = [
  {
    name: "Class details (FICTIONAL)",
    language: "en",
    body: "Hi {name}, this is {caller} from Pasindu Athukorala ICT class. {class} starts on {start_date}. Fee: {fee}. Register: {link}",
  },
  {
    name: "පන්ති විස්තර (FICTIONAL)",
    language: "si",
    body: "ආයුබෝවන් {name}! මම {caller}, පසිඳු අතුකෝරල ICT පන්තියෙන්. {class} පන්තිය {start_date} ආරම්භ වේ. ගාස්තුව {fee}. ලියාපදිංචි වන්න: {link}",
  },
  {
    name: "Payment details (TEST)",
    language: "en",
    body: "Hi {name}, thank you for joining {class}! The fee is {fee}. After paying, please send a photo of the payment slip to this number. Details: {link}\n— {caller}, Pasindu Athukorala ICT (TEST)",
  },
  {
    name: "ගෙවීම් විස්තර (TEST)",
    language: "si",
    body: "ආයුබෝවන් {name}, {class} පන්තියට සම්බන්ධ වීම ගැන ස්තූතියි! ගාස්තුව {fee}. ගෙවීමෙන් පසු ගෙවීම් පත්‍රිකාවේ ඡායාරූපයක් මෙම අංකයට එවන්න. විස්තර: {link}\n— {caller}, පසිඳු අතුකෝරල ICT (TEST)",
  },
  {
    name: "Class reminder (TEST)",
    language: "en",
    body: "Hi {name}, a quick reminder that {class} starts on {start_date}. Reply here if you have any questions.\n— {caller} (TEST)",
  },
  {
    name: "පන්ති සිහිකැඳවීම (TEST)",
    language: "si",
    body: "ආයුබෝවන් {name}, {class} පන්තිය {start_date} දින ආරම්භ වන බව සිහිපත් කරමු. ප්‍රශ්න ඇත්නම් මෙහි පිළිතුරු දෙන්න.\n— {caller} (TEST)",
  },
] as const;
const existing = new Set(
  (await db.select({ name: templates.name }).from(templates).where(inArray(templates.name, texts.map((t) => t.name)))).map((t) => t.name),
);
const missing = texts.filter((t) => !existing.has(t.name));
if (missing.length) await db.insert(templates).values([...missing]);

// Two callbacks for Nimali so "Today" and calling mode have something to show.
const now = Date.now();
for (const [phone, dueAt, note] of [
  ["0710000001", new Date(now - 3600_000), "Asked to call after school (FICTIONAL)"],
  ["0710000003", new Date(now + 2 * 3600_000), "Parent will be home (FICTIONAL)"],
] as const) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.campaignId, campaign.id), eq(contacts.phone, phone)));
  if (!c) continue;
  const inserted = await db
    .insert(callbacks)
    .values({
      campaignId: campaign.id,
      contactId: c.id,
      callerId: c.assignedTo,
      dueAt,
      note,
      history: [{ at: new Date().toISOString(), action: "created", dueAt: dueAt.toISOString() }],
    })
    .onConflictDoNothing({ target: callbacks.contactId, where: sql`status = 'pending'` })
    .returning({ id: callbacks.id });
  if (inserted.length) await db.update(contacts).set({ nextCallbackAt: dueAt }).where(eq(contacts.id, c.id));
}

console.log(`Seeded ${people.length} fictional users on ${url.host}. Password for all: ${PASSWORD}`);
console.log(people.map((u) => `  ${u.role.padEnd(6)} ${u.email}`).join("\n"));
console.log(`Seeded campaign "${CAMPAIGN}" with 60 fictional contacts, ${texts.length} templates and 2 callbacks.`);
await db.$client.end();
