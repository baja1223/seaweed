import mongoose from "mongoose";
import { log } from "./Common Utilities.js";

export async function connectMongo(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  log("[content][db] connected");
}

