import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";
import { OUTCOMES, STAGES } from "../vocab";

const contactSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true }, // normalized 07XXXXXXXX, see lib/phone.ts
    altPhone: { type: String }, // parent
    school: { type: String, trim: true },
    district: { type: String, trim: true },
    gradeOrBatch: { type: String, trim: true },
    source: { type: String, trim: true },
    tags: { type: [String], default: [] },
    notes: { type: String, default: "" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    stage: { type: String, enum: STAGES, default: "new" },
    stageChangedAt: { type: Date, default: Date.now },
    lastCallAt: { type: Date, default: null },
    lastOutcome: { type: String, enum: [...OUTCOMES, null], default: null },
    nextCallbackAt: { type: Date, default: null }, // mirrors the pending callback, for sorting and "next contact"
    lastWhatsappAt: { type: Date, default: null },
    importBatchId: { type: Schema.Types.ObjectId, ref: "ImportBatch" },
  },
  { timestamps: true },
);
contactSchema.index({ campaignId: 1, phone: 1 }, { unique: true });
contactSchema.index({ phone: 1 }); // "already in another campaign" warning
contactSchema.index({ campaignId: 1, assignedTo: 1, stage: 1 });
contactSchema.index({ campaignId: 1, createdAt: -1 });
contactSchema.index({ campaignId: 1, assignedTo: 1, nextCallbackAt: 1 });
contactSchema.index({ campaignId: 1, assignedTo: 1, lastCallAt: 1 });

export type ContactDoc = InferSchemaType<typeof contactSchema>;
export const Contact = (models.Contact as Model<ContactDoc>) ?? model("Contact", contactSchema);
