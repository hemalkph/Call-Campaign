// Local PostgreSQL for development — no install or Docker needed. It's PGlite (Postgres compiled
// to WebAssembly) served on the normal Postgres port. Data is kept in .pgdata/.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const pg = await PGlite.create(".pgdata");
await migrate(drizzle(pg), { migrationsFolder: "drizzle" }); // always up to date
// Two connections (the app + a script like the seed). PGlite is single-connection underneath; more
// simultaneous connections can garble replies, so the app uses a pool of 1 locally (DATABASE_POOL_MAX).
const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 5432, maxConnections: 2 });
await server.start();
console.log("PostgreSQL (PGlite) running — use DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres");
console.log("Press Ctrl+C to stop.");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await server.stop();
    await pg.close();
    process.exit(0);
  });
}
