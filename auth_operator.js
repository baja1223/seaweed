import bcrypt from "bcrypt";
import { User } from "./auth_models.js";
import { err, log } from "./Common Utilities.js";

export const DEFAULT_OPERATOR_PASSWORD = "operator-local-change-me";

export function isOperator(user) {
  if (!user) return false;
  const id = String(user._id ?? user.id ?? "");
  if (process.env.OPERATOR_USER_ID && id === process.env.OPERATOR_USER_ID) return true;
  const email = (process.env.OPERATOR_EMAIL || "").trim().toLowerCase();
  const username = (process.env.OPERATOR_USERNAME || "").trim();
  if (email && user.email === email) return true;
  if (username && user.username === username) return true;
  return false;
}

export function accessPayload(user) {
  return {
    sub: user._id.toString(),
    username: user.username,
    email: user.email,
    operator: isOperator(user)
  };
}

export async function ensureOperator() {
  const username = (process.env.OPERATOR_USERNAME || "").trim();
  const email = (process.env.OPERATOR_EMAIL || "").trim().toLowerCase();
  const password = process.env.OPERATOR_PASSWORD || "";
  if (!username && !email && !password) return;
  if (!username || !email || !password) {
    err("Set OPERATOR_USERNAME, OPERATOR_EMAIL, and OPERATOR_PASSWORD together, or leave all three unset.");
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    err("OPERATOR_USERNAME must be 3–32 letters, numbers, periods, underscores, or hyphens.");
    process.exit(1);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    err("OPERATOR_EMAIL must be a valid email address.");
    process.exit(1);
  }
  if (password.length < 8 || Buffer.byteLength(password) > 72) {
    err("OPERATOR_PASSWORD must be at least 8 characters and at most 72 bytes.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && password === DEFAULT_OPERATOR_PASSWORD) {
    err("Refusing to start in production with the local default operator password. Set OPERATOR_PASSWORD.");
    process.exit(1);
  }

  const byUsername = await User.findOne({ username });
  const byEmail = await User.findOne({ email });
  if (byUsername && byEmail && String(byUsername._id) !== String(byEmail._id)) {
    err("OPERATOR_USERNAME and OPERATOR_EMAIL already belong to two different accounts.");
    process.exit(1);
  }

  let user = byUsername || byEmail;
  if (!user) {
    user = await User.create({ username, email, passwordHash: await bcrypt.hash(password, 12) });
    log(`[auth] created operator account ${username}`);
  } else {
    const samePassword = await bcrypt.compare(password, user.passwordHash);
    const sameIdentity = user.username === username && user.email === email;
    if (!samePassword || !sameIdentity) {
      user.username = username;
      user.email = email;
      if (!samePassword) user.passwordHash = await bcrypt.hash(password, 12);
      await user.save();
      log(`[auth] updated operator account ${username}`);
    } else {
      log(`[auth] operator account ${username} already exists`);
    }
  }

  process.env.OPERATOR_USER_ID = String(user._id);
  if (password === DEFAULT_OPERATOR_PASSWORD) {
    log(`[auth] operator login: ${username} or ${email} / ${password}`);
    log("[auth] change OPERATOR_PASSWORD before sharing this app on the internet");
  } else {
    log(`[auth] operator login: ${username} or ${email}`);
  }
}
