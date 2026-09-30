// Applies the SQL migrations in drizzle/ to DATABASE_URL (local or production).
import "./env.mts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
await migrate(drizzle(client), { migrationsFolder: "drizzle" });
console.log("Migrations applied.");
await client.end();
