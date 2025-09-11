import { pool } from "./streams_db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

// simple stream key generator
function makeStreamKey() {
  return crypto.randomBytes(24).toString("hex");
}

export async function startStream(req, res) {
  const { title } = req.body || {};
  const userId = req.headers["x-user-id"] || "anonymous";
  if (!title) return res.status(400).json({ error: "title is required" });

  const id = uuid();
  const streamKey = makeStreamKey();
  await pool.query(
    "INSERT INTO streams (id, user_id, title, stream_key) VALUES ($1,$2,$3,$4)",
    [id, userId, title, streamKey]
  );

  return res.status(201).json({
    id, title, streamKey, startedAt: new Date().toISOString()
  });
}

export async function endStream(req, res) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });
  await pool.query(
    "UPDATE streams SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [id]
  );
  return res.json({ ok: true, id });
}

export async function listStreams(_req, res) {
  const { rows } = await pool.query(
    "SELECT id, user_id, title, started_at FROM streams WHERE ended_at IS NULL ORDER BY started_at DESC"
  );
  // viewer count placeholder (wired later to real metrics)
  const data = rows.map(r => ({
    id: r.id,
    title: r.title,
    userId: r.user_id,
    startedAt: r.started_at,
    viewerCount: Math.floor(Math.random() * 1000) // mock
  }));
  return res.json({ streams: data });
}
