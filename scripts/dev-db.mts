// Local MongoDB for development without installing MongoDB or Docker. Data persists in .dev-db/.
import { mkdirSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";

mkdirSync(".dev-db", { recursive: true });
const server = await MongoMemoryServer.create({
  instance: { port: 27017, dbPath: ".dev-db", storageEngine: "wiredTiger" },
});
console.log(`MongoDB running at ${server.getUri()} — use MONGODB_URI=mongodb://127.0.0.1:27017/call-campaign-dev`);
console.log("Press Ctrl+C to stop.");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await server.stop({ doCleanup: false });
    process.exit(0);
  });
}
