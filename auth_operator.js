import bcrypt from "bcrypt";
import { User } from "./auth_models.js";
import { err, log } from "./Common Utilities.js";

export const DEFAULT_OPERATOR_PASSWORD = "operator-local-change-me";

function envValue(name) {
  let value = process.env[name] || "";
  value = value.replace(/\r/g, "").trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isOperator(user) {
  if (!user) return false;
  const id = String(user._id ?? user.id ?? "");
  if (process.env.OPERATOR_USER_ID && id === process.env.OPERATOR_USER_ID) return true;
  const email = envValue("OPERATOR_EMAIL").toLowerCase();
  const username = envValue("OPERATOR_USERNAME");
  if (email && user.email === email) return true;
  if (username && user.username.toLowerCase() === username.toLowerCase()) return true;
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

async function findByUsername(username) {
  const exact = await User.findOne({ username });
  if (exact) return exact;
  return User.findOne({ username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } });
}

async function releaseIdentity(other, username, email) {
  const previous = `${other.username} / ${other.email}`;
  let changed = false;
  if (other.username.toLowerCase() === username.toLowerCase()) {
    other.username = `former${String(other._id).slice(-8)}`;
    changed = true;
  }
  if (other.email === email) {
    other.email = `former-${other._id}@users.local`;
    changed = true;
  }
  if (!changed) return;
  await other.save();
  log(`[auth] moved account ${previous} to ${other.username} / ${other.email} so the operator can use ${username}`);
}

export async function ensureOperator() {
  const username = envValue("OPERATOR_USERNAME");
  const email = envValue("OPERATOR_EMAIL").toLowerCase();
  const password = envValue("OPERATOR_PASSWORD");
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

  const byUsername = await findByUsername(username);
  const byEmail = await User.findOne({ email });
  let user = byUsername || byEmail;
  if (byUsername && byEmail && String(byUsername._id) !== String(byEmail._id)) {
    const other = String(user._id) === String(byUsername._id) ? byEmail : byUsername;
    await releaseIdentity(other, username, email);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  if (!user) {
    user = await User.create({ username, email, passwordHash });
    log(`[auth] created operator account ${username}`);
  } else {
    user.username = username;
    user.email = email;
    user.passwordHash = passwordHash;
    await user.save();
    log(`[auth] synced operator account ${username}`);
  }

  process.env.OPERATOR_USER_ID = String(user._id);
  process.env.OPERATOR_USERNAME = username;
  process.env.OPERATOR_EMAIL = email;
  process.env.OPERATOR_PASSWORD = password;
  log(`[auth] operator login: ${username} or ${email}`);
  if (password === DEFAULT_OPERATOR_PASSWORD) {
    log("[auth] change OPERATOR_PASSWORD before sharing this app on the internet");
  }
}
