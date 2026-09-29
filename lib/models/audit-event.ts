import { type InferSchemaType, model, models, type Model, Schema, type Types } from "mongoose";

// Never put phone numbers or passwords in before/after.
const auditEventSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true }, // e.g. "user.create"
  entity: { type: String, required: true }, // collection name
  entityId: { type: Schema.Types.ObjectId },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  at: { type: Date, default: Date.now, index: true },
});
auditEventSchema.index({ entity: 1, entityId: 1, at: -1 });

export type AuditEventDoc = InferSchemaType<typeof auditEventSchema>;
export const AuditEvent =
  (models.AuditEvent as Model<AuditEventDoc>) ?? model("AuditEvent", auditEventSchema, "auditEvents");

type Id = string | Types.ObjectId;

export function audit(e: { actorId?: Id; action: string; entity: string; entityId?: Id; before?: object; after?: object }) {
  return AuditEvent.create(e);
}
