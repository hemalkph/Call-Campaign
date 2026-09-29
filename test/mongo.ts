// Import from a test file to get a throwaway in-memory MongoDB for that file.
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll } from "vitest";
import { connectDb } from "@/lib/db";

let server: MongoMemoryServer;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("call-campaign-test");
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
