// Playwright web server: throwaway in-memory MongoDB + fictional seed + the production build.
import { execSync, spawn } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri("call-campaign-test"),
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-not-for-production",
  LOGIN_IP_LIMIT: "1000", // all test browsers share one IP
};
execSync("npx tsx scripts/seed.mts", { env, stdio: "inherit" });

const next = spawn("npx", ["next", "start", "-p", "3100"], { env, stdio: "inherit" });
const stop = async () => {
  next.kill();
  await mongo.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
