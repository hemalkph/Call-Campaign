import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";
import { ROLES } from "../schemas";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    active: { type: Boolean, default: true },
    phone: { type: String }, // normalized, see lib/phone.ts
    mustChangePassword: { type: Boolean, default: true },
    // Bumped on password reset / deactivation; sessions carrying an older value are rejected.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = (models.User as Model<UserDoc>) ?? model("User", userSchema);
