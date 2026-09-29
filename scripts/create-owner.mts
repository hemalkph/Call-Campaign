// Creates the first owner account (works on any database, including production).
// Usage: npm run create-owner -- "Full Name" email@example.com
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { audit } from "@/lib/models/audit-event";
import { User } from "@/lib/models/user";
import { hashPassword, tempPassword } from "@/lib/password";
import { createUserSchema } from "@/lib/schemas";

try {
  process.loadEnvFile(".env.local");
} catch {}

const [name, email] = process.argv.slice(2);
const parsed = createUserSchema.safeParse({ name: name ?? "", email: email ?? "", phone: "", role: "owner" });
if (!parsed.success) {
  console.error('Usage: npm run create-owner -- "Full Name" email@example.com');
  process.exit(1);
}

await connectDb();
if (await User.exists({ email: parsed.data.email })) {
  console.error("A user with this email already exists.");
  process.exit(1);
}
const password = tempPassword();
const user = await User.create({ ...parsed.data, passwordHash: await hashPassword(password) });
await audit({ action: "user.create", entity: "users", entityId: user._id, after: { name: user.name, email: user.email, role: "owner" } });
console.log(`Owner created. Temporary password (shown once, change it at first sign-in): ${password}`);
await mongoose.disconnect();
