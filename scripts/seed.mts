// FICTIONAL development data. Refuses to run unless the database name ends in -dev or -test.
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { Callback } from "@/lib/models/callback";
import { Campaign } from "@/lib/models/campaign";
import { Contact } from "@/lib/models/contact";
import { Template } from "@/lib/models/template";
import { User } from "@/lib/models/user";
import { STAGES } from "@/lib/vocab";
import { hashPassword } from "@/lib/password";

try {
  process.loadEnvFile(".env.local");
} catch {}

const uri = process.env.MONGODB_URI ?? "";
const dbName = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
if (!/-(dev|test)$/.test(dbName) || process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  console.error(`Refusing to seed database "${dbName}". Seeding only runs on databases named *-dev or *-test.`);
  process.exit(1);
}

const PASSWORD = "fictional-dev-pw";
const users = [
  { name: "Test Owner (FICTIONAL)", email: "owner@example.test", role: "owner" },
  { name: "Nimali Test (FICTIONAL)", email: "nimali@example.test", role: "caller", phone: "0710000001" },
  { name: "Kasun Test (FICTIONAL)", email: "kasun@example.test", role: "caller", phone: "0770000002" },
] as const;

await connectDb();
const passwordHash = await hashPassword(PASSWORD);
for (const u of users) {
  await User.updateOne(
    { email: u.email },
    { $setOnInsert: { ...u, passwordHash, mustChangePassword: false } },
    { upsert: true },
  );
}

const [nimali, kasun] = await User.find({ email: { $in: ["nimali@example.test", "kasun@example.test"] } }).sort({ email: -1 });
const campaign = await Campaign.findOneAndUpdate(
  { name: "October intake (FICTIONAL)" },
  {
    $setOnInsert: {
      classLabel: "2027 A/L Theory",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      status: "active",
      dailyCallTarget: 40,
      enrollmentTarget: 25,
      script: "Hello, this is {caller} from Pasindu Athukorala ICT class. (FICTIONAL script)",
      callers: [{ userId: nimali._id }, { userId: kasun._id, dailyCallTarget: 30 }],
    },
  },
  { upsert: true, returnDocument: "after" },
);
const schools = ["Test College A", "Test Vidyalaya B", "Sample MV C"];
const districts = ["Colombo", "Gampaha", "Kandy", "Galle", "Kurunegala"];
await Contact.bulkWrite(
  Array.from({ length: 60 }, (_, i) => ({
    updateOne: {
      filter: { campaignId: campaign._id, phone: `07100${String(i).padStart(5, "0")}` },
      update: {
        $setOnInsert: {
          name: `Test Student ${String(i + 1).padStart(2, "0")} (FICTIONAL)`,
          school: schools[i % 3],
          district: districts[i % 5],
          gradeOrBatch: "2027 A/L",
          source: i % 2 ? "Facebook ad" : "Seminar",
          tags: i % 7 === 0 ? ["revision"] : [],
          assignedTo: i % 10 === 9 ? null : i % 2 ? nimali._id : kasun._id,
          stage: STAGES[i % 5 === 0 ? i % STAGES.length : 0],
        },
      },
      upsert: true,
    },
  })),
);

await Campaign.updateOne(
  { _id: campaign._id, fee: { $in: [null, ""] } },
  { fee: "Rs. 2,500 / month (FICTIONAL)", link: "https://example.test/join" },
);

const templates = [
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
for (const t of templates) await Template.updateOne({ name: t.name }, { $setOnInsert: t }, { upsert: true });

// Two callbacks for Nimali so "Today" and calling mode have something to show.
const now = Date.now();
for (const [phone, dueAt, note] of [
  ["0710000001", new Date(now - 3600_000), "Asked to call after school (FICTIONAL)"],
  ["0710000003", new Date(now + 2 * 3600_000), "Parent will be home (FICTIONAL)"],
] as const) {
  const c = await Contact.findOne({ campaignId: campaign._id, phone });
  if (c && !(await Callback.exists({ contactId: c._id, status: "pending" }))) {
    await Callback.create({ campaignId: campaign._id, contactId: c._id, callerId: c.assignedTo, dueAt, note, history: [{ action: "created", dueAt }] });
    await Contact.updateOne({ _id: c._id }, { nextCallbackAt: dueAt });
  }
}

console.log(`Seeded ${users.length} fictional users in "${dbName}". Password for all: ${PASSWORD}`);
console.log(users.map((u) => `  ${u.role.padEnd(6)} ${u.email}`).join("\n"));
console.log(`Seeded campaign "${campaign.name}" with 60 fictional contacts, 6 templates and 2 callbacks.`);
await mongoose.disconnect();
