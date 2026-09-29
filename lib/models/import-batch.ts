import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";
import { STRATEGIES } from "../import";

// One document per import. Holds row numbers and outcome codes only — never names or phones.
const importBatchSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // idempotency key from the browser
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fileName: { type: String, default: "" },
    mapping: { type: Schema.Types.Mixed }, // field → column header
    strategy: { type: String, enum: STRATEGIES, required: true },
    oneCallerId: { type: Schema.Types.ObjectId, ref: "User" },
    defaultTags: { type: [String], default: [] },
    defaultSource: { type: String, default: "" },
    totalRows: { type: Number, default: 0 },
    rejectedInBrowser: { type: Schema.Types.Mixed }, // counts per reject code found in the preview
    chunks: [
      {
        _id: false,
        index: { type: Number, required: true },
        created: [Number], // spreadsheet row numbers
        skipped: [Number], // already in campaign
        invalid: [Number],
      },
    ],
    status: { type: String, enum: ["running", "done"], default: "running" },
    finishedAt: Date,
  },
  { timestamps: true },
);

export type ImportBatchDoc = InferSchemaType<typeof importBatchSchema>;
export const ImportBatch =
  (models.ImportBatch as Model<ImportBatchDoc>) ?? model("ImportBatch", importBatchSchema, "importBatches");
