import mongoose from "mongoose";
import { log } from "../common/logger.js";

export async function connectMongo(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  log("[auth][db] connected");
}
