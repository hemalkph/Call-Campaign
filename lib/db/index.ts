// One PostgreSQL connection pool per server instance, reused across requests (and hot reloads).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

const g = globalThis as unknown as { db?: Db };

function create(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    prepare: false, // Supabase's transaction pooler (port 6543) doesn't support prepared statements
    max: Number(process.env.DATABASE_POOL_MAX) || 3, // serverless: a few connections per instance
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

/** Tests swap in an in-memory PGlite database. */
export function setDb(db: Db) {
  g.db = db;
}

/** The database, created on first use. */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    g.db ??= create();
    const value = Reflect.get(g.db, prop);
    // Bind methods (select, insert, transaction…) but hand out $client untouched: it's a function with methods of its own.
    return typeof value === "function" && prop !== "$client" ? value.bind(g.db) : value;
  },
});

export * from "./schema";
