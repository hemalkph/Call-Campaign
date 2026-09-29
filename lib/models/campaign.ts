import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";
import { CAMPAIGN_STATUSES } from "../vocab";

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true }, // e.g. "2027 A/L Theory"
    startDate: { type: String, required: true }, // calendar date "YYYY-MM-DD" (Sri Lanka)
    endDate: { type: String, required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft" },
    dailyCallTarget: { type: Number, default: 0 },
    enrollmentTarget: { type: Number, default: 0 },
    script: { type: String, default: "" }, // markdown
    fee: { type: String, default: "" }, // for the {fee} placeholder, e.g. "Rs. 2,500 / month"
    link: { type: String, default: "" }, // for {link}, e.g. a registration form
    // Callers working this campaign; dailyCallTarget overrides the campaign default when set.
    callers: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        dailyCallTarget: { type: Number },
      },
    ],
  },
  { timestamps: true },
);
campaignSchema.index({ "callers.userId": 1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema>;
export const Campaign = (models.Campaign as Model<CampaignDoc>) ?? model("Campaign", campaignSchema);
