import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes SQL migrations to drizzle/ from lib/db/schema.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
