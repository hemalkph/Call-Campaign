import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";

// Logged when the caller confirms they sent a message. The app only opens WhatsApp; it never sends.
const whatsappLogSchema = new Schema({
  campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
  contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
  callerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  templateId: { type: Schema.Types.ObjectId, ref: "Template" },
  templateName: { type: String, default: "" }, // kept if the template is later deleted
  sentAt: { type: Date, default: Date.now },
  note: { type: String, default: "" },
});
whatsappLogSchema.index({ contactId: 1, sentAt: -1 });
whatsappLogSchema.index({ campaignId: 1, sentAt: -1 });

export type WhatsappLogDoc = InferSchemaType<typeof whatsappLogSchema>;
export const WhatsappLog =
  (models.WhatsappLog as Model<WhatsappLogDoc>) ?? model("WhatsappLog", whatsappLogSchema, "whatsappLogs");
