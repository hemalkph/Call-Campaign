// Playwright web server: throwaway in-memory PostgreSQL (PGlite) + fictional seed + the production build.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const PORT = 5433; // not 5432, so it never touches a dev database
const pg = await PGlite.create();
await migrate(drizzle(pg), { migrationsFolder: "drizzle" });
// PGlite is single-connection; its socket multiplexer garbles replies under concurrency, so one connection it is.
const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: PORT });
await server.start();

const env = {
  ...process.env,
  DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/postgres`,
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-not-for-production",
  LOGIN_IP_LIMIT: "1000", // all test browsers share one IP
  DATABASE_POOL_MAX: "1", // see above; queries queue on the one connection
};
// Not execSync: the database lives in this process and must keep answering while the seed runs.
const seed = spawn("npx", ["tsx", "scripts/seed.mts"], { env, stdio: "inherit" });
const [code] = await once(seed, "exit");
if (code !== 0) throw new Error("Seeding the test database failed");

const next = spawn("npx", ["next", "start", "-p", "3100"], { env, stdio: "inherit" });
const stop = async () => {
  next.kill();
  await server.stop();
  await pg.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
