import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    tags: { type: [String], default: [] },
    authorId: { type: String },
  },
  { timestamps: true }
);

export const Item = mongoose.models.Item || mongoose.model("Item", ItemSchema);

