import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";
import { OUTCOMES } from "../vocab";

// Append-only call history. `undo` holds what the call changed, so the caller can undo within seconds.
const callSchema = new Schema({
  campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
  contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
  callerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  calledAt: { type: Date, default: Date.now },
  outcome: { type: String, enum: OUTCOMES, required: true },
  durationSec: { type: Number },
  notes: { type: String, default: "" },
  undo: { type: Schema.Types.Mixed, select: false },
});
callSchema.index({ contactId: 1, calledAt: -1 });
callSchema.index({ campaignId: 1, calledAt: -1 });
callSchema.index({ callerId: 1, calledAt: -1 });

export type CallDoc = InferSchemaType<typeof callSchema>;
export const Call = (models.Call as Model<CallDoc>) ?? model("Call", callSchema);
