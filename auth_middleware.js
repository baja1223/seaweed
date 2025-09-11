import jwt from "jsonwebtoken";
import { User } from "./auth_models.js";

export async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing bearer token" });

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded.sub).lean();
    if (!user) return res.status(401).json({ error: "user no longer exists" });

    req.user = { id: user._id, username: user.username, email: user.email, author: user.author || "john seaweed" };
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}
