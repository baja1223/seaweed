import bcrypt from "bcrypt";
import { User } from "./models.js";
import { signAccess, signRefresh } from "../common/jwt.js";

export async function register(req, res) {
  try {
    const { username, email, password, author } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email, and password are required" });
    }
    const existing = await User.findOne({ $or: [{ email }, { username }] }).lean();
    if (existing) return res.status(409).json({ error: "username or email already in use" });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash, author: author || "john seaweed" });

    const payload = { sub: user._id.toString(), username: user.username, email: user.email };
    return res.status(201).json({
      user: { id: user._id, username: user.username, email: user.email, author: user.author },
      accessToken: signAccess(payload),
      refreshToken: signRefresh({ sub: payload.sub })
    });
  } catch {
    return res.status(500).json({ error: "registration failed" });
  }
}

export async function login(req, res) {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "emailOrUsername and password are required" });
    }
    const user = await User.findOne({
      $or: [{ email: emailOrUsername.toLowerCase() }, { username: emailOrUsername }]
    });
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const payload = { sub: user._id.toString(), username: user.username, email: user.email };
    return res.json({
      user: { id: user._id, username: user.username, email: user.email, author: user.author },
      accessToken: signAccess(payload),
      refreshToken: signRefresh({ sub: payload.sub })
    });
  } catch {
    return res.status(500).json({ error: "login failed" });
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
    const payload = { sub: user._id.toString(), username: user.username, email: user.email };
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
