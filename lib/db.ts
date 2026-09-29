import mongoose from "mongoose";

// Reuse one connection across hot reloads and warm serverless invocations.
const g = globalThis as unknown as { mongoose?: Promise<typeof mongoose> };

export function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g.mongoose ??= mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }).catch((e) => {
    g.mongoose = undefined; // allow a retry on the next request
    throw e;
  });
  return g.mongoose;
}
