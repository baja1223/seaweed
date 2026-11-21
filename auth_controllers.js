import bcrypt from "bcrypt";
import { User } from "./auth_models.js";
import { signAccess, signRefresh } from "./common_jwt.js";
import { accessPayload, isOperator } from "./auth_operator.js";

import { audit } from "./local/audit.js";
import { err, log } from "./Common Utilities.js";

const account = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  author: user.author,
  operator: isOperator(user)
});

export async function register(req, res) {
  try {
    const input = req.body || {};
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const { password } = input;
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: "Use 3–32 letters, numbers, periods, underscores, or hyphens for your username." });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: "Use a password of at least 8 characters and at most 72 bytes." });
    }
    const existing = await User.findOne({ $or: [{ email }, { username }] }).lean();
    if (existing) return res.status(409).json({ error: "username or email already in use" });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash });
    try {
      await audit("account.created", user.id);
    } catch (error) {
      await User.deleteOne({ _id: user.id });
      throw error;
    }

    const payload = accessPayload(user);
    return res.status(201).json({
      user: account(user),
      accessToken: signAccess(payload),
      refreshToken: signRefresh({ sub: payload.sub })
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "username or email already in use" });
    return res.status(500).json({ error: "registration failed" });
  }
}

function loginIdentifier(body) {
  const input = body || {};
  const value = input.emailOrUsername ?? input.username ?? input.email ?? "";
  return typeof value === "string" ? value.replace(/\r/g, "").trim() : "";
}

export async function login(req, res) {
  const identifier = loginIdentifier(req.body);
  try {
    const password = req.body?.password;
    if (!identifier || typeof password !== "string" || !password || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: "Enter a username or email, and a password.", reason: "missing_fields" });
    }
    const lowered = identifier.toLowerCase();
    const user = await User.findOne({ email: lowered })
      || await User.findOne({ username: identifier })
      || await User.findOne({ username: { $regex: `^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    if (!user) {
      log(`[auth] login failed: no such user (${identifier})`);
      return res.status(401).json({
        error: "No such user.",
        reason: "no_such_user"
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      log(`[auth] login failed: wrong password for ${user.username}`);
      return res.status(401).json({
        error: "Wrong password.",
        reason: "wrong_password"
      });
    }
    await audit("account.signed_in", user.id);

    const payload = accessPayload(user);
    return res.json({
      user: account(user),
      accessToken: signAccess(payload),
      refreshToken: signRefresh({ sub: payload.sub })
    });
  } catch (error) {
    err(`[auth] login failed: server error for ${identifier || "(blank)"}: ${error?.message || error}`);
    return res.status(500).json({ error: "Server unreachable.", reason: "server_error" });
  }
}

export async function refresh(req, res) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
    const jwt = await import("jsonwebtoken");
    const decoded = jwt.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: "invalid refresh token" });
    const payload = accessPayload(user);
    return res.json({
      accessToken: signAccess(payload),
      refreshToken: signRefresh({ sub: payload.sub })
    });
  } catch {
    return res.status(401).json({ error: "invalid or expired refresh token" });
  }
}

export async function profile(req, res) {
  return res.json({ user: req.user });
}
