import { type InferSchemaType, model, models, type Model, Schema } from "mongoose";

const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    language: { type: String, enum: ["si", "en"], required: true },
    body: { type: String, required: true }, // placeholders: {name} {class} {fee} {start_date} {link} {caller}
  },
  { timestamps: true },
);

export type TemplateDoc = InferSchemaType<typeof templateSchema>;
export const Template = (models.Template as Model<TemplateDoc>) ?? model("Template", templateSchema);
