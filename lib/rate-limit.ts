import { eq, lt, sql } from "drizzle-orm";
import { db, loginAttempts } from "./db";

/** Counts one hit against `key` (fixed window); returns false once more than `limit` hits land in the window. */
export async function hit(key: string, limit: number, windowMs: number) {
  const expires = sql`now() + ${windowMs} * interval '1 millisecond'`;
  const [row] = await db
    .insert(loginAttempts)
    .values({ key, count: 1, expiresAt: expires })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`case when ${loginAttempts.expiresAt} > now() then ${loginAttempts.count} + 1 else 1 end`,
        expiresAt: sql`case when ${loginAttempts.expiresAt} > now() then ${loginAttempts.expiresAt} else excluded.expires_at end`,
      },
    })
    .returning({ count: loginAttempts.count });
  if (Math.random() < 0.02) await db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, sql`now() - interval '1 day'`)); // tidy up
  return row.count <= limit;
}

export function clear(key: string) {
  return db.delete(loginAttempts).where(eq(loginAttempts.key, key));
}
