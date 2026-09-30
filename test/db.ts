// Import from a test file to get a throwaway in-memory PostgreSQL (PGlite), built from the real migrations.
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll } from "vitest";
import { type Db, setDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const pg = new PGlite();
export const testDb = drizzle(pg, { schema, casing: "snake_case" });

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: "drizzle" });
  setDb(testDb as unknown as Db); // same query API as the postgres-js driver
}, 60_000);

/** Empties every table (fast, keeps the schema). */
export async function resetDb() {
  await testDb.execute(sql`truncate users, campaigns, campaign_callers, import_batches, import_chunks, contacts,
    calls, callbacks, templates, whatsapp_logs, audit_events, login_attempts restart identity cascade`);
}
