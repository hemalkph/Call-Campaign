// Creates the first owner account (works on any database, including production).
// Usage: npm run create-owner -- "Full Name" email@example.com
import "./env.mts";
import { eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, tempPassword } from "@/lib/password";
import { createUserSchema } from "@/lib/schemas";

const [name, email] = process.argv.slice(2);
const parsed = createUserSchema.safeParse({ name: name ?? "", email: email ?? "", phone: "", role: "owner" });
if (!parsed.success) {
  console.error('Usage: npm run create-owner -- "Full Name" email@example.com');
  process.exit(1);
}

if ((await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email))).length) {
  console.error("A user with this email already exists.");
  process.exit(1);
}
const password = tempPassword();
const [user] = await db
  .insert(users)
  .values({ ...parsed.data, passwordHash: await hashPassword(password) })
  .returning();
await audit({ action: "user.create", entity: "users", entityId: user.id, after: { name: user.name, email: user.email, role: "owner" } });
console.log(`Owner created. Temporary password (shown once, change it at first sign-in): ${password}`);
await db.$client.end();
