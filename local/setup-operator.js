import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { parse } from "dotenv";
import mongoose from "mongoose";
import { User } from "../auth_models.js";

const directory = join(homedir(), ".pulseplay-local");
const environmentFile = join(directory, "runtime.env");
const credentialFile = join(directory, "operator.txt");
if (existsSync(environmentFile) || existsSync(credentialFile)) {
  throw new Error("Local operator files already exist. Reuse them.");
}

const envFile = existsSync(fileURLToPath(new URL("../.env", import.meta.url)))
  ? new URL("../.env", import.meta.url)
  : new URL("../.env.example", import.meta.url);
const config = parse(readFileSync(envFile));
for (const endpoint of [new URL(config.MONGO_URI).hostname, new URL(config.REDIS_URL).hostname, config.PGHOST]) {
  if (!["127.0.0.1", "localhost"].includes(endpoint)) throw new Error("Use only local databases.");
}

const username = "taha-operator";
const email = "taha-operator@pulseplay.test";
const password = randomBytes(24).toString("base64url");
mkdirSync(directory, { recursive: true, mode: 0o700 });
await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 4000 });
try {
  await User.init();
  if (await User.exists({ $or: [{ username }, { email }] })) {
    throw new Error("The reserved operator username or email already exists.");
  }
  const user = await User.create({ username, email, passwordHash: await bcrypt.hash(password, 12) });
  const options = { flag: "wx", mode: 0o600 };
  writeFileSync(environmentFile, Object.entries({
    ...config,
    CORS_ORIGIN: "http://127.0.0.1:4173",
    JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
    OPERATOR_USER_ID: String(user.id),
    LOCAL_BIND: "127.0.0.1",
    MEDIA_CONTROL_URL: "http://127.0.0.1:9997"
  }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", options);
  writeFileSync(credentialFile, `Username: ${username}\nPassword: ${password}\n`, options);
  console.log(`Created local operator. Credentials: ${credentialFile}`);
} finally {
  await mongoose.disconnect();
}
