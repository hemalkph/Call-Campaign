import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";

export const CALLBACK_STATUSES = ["pending", "done", "cancelled"] as const;

const callbackSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    callerId: { type: Schema.Types.ObjectId, ref: "User", default: null }, // follows the contact's caller
    dueAt: { type: Date, required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: CALLBACK_STATUSES, default: "pending" },
    history: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: "User" },
        action: { type: String, enum: ["created", "rescheduled", "done", "cancelled", "reopened"] },
        dueAt: Date,
        reason: String,
      },
    ],
  },
  { timestamps: true },
);
// At most one pending callback per contact.
callbackSchema.index({ contactId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
callbackSchema.index({ callerId: 1, status: 1, dueAt: 1 });
callbackSchema.index({ campaignId: 1, status: 1, dueAt: 1 });

export type CallbackDoc = InferSchemaType<typeof callbackSchema>;
export const Callback = (models.Callback as Model<CallbackDoc>) ?? model("Callback", callbackSchema);
