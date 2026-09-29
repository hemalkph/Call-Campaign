import { model, models, type Model, Schema } from "mongoose";

// Fixed-window counters; the TTL index removes expired windows.
const loginAttemptSchema = new Schema({
  key: { type: String, required: true, index: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});

const LoginAttempt =
  (models.LoginAttempt as Model<{ key: string; count: number; expiresAt: Date }>) ??
  model("LoginAttempt", loginAttemptSchema, "loginAttempts");

/** Counts one hit against `key`; returns false once more than `limit` hits land in the window. */
export async function hit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  const doc = await LoginAttempt.findOneAndUpdate(
    { key, expiresAt: { $gt: now } },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + windowMs) } },
    { upsert: true, returnDocument: "after" },
  );
  return doc.count <= limit;
}

export function clear(key: string) {
  return LoginAttempt.deleteMany({ key });
}
