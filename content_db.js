import mongoose from "mongoose";
import { log, retry } from "./Common Utilities.js";

export async function connectMongo(uri) {
  mongoose.set("strictQuery", true);
  await retry("[content][db]", async () => {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    } catch (error) {
      await mongoose.disconnect().catch(() => {});
      throw error;
    }
  });
  log("[content][db] connected");
}

