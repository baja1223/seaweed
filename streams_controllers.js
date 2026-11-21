import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "./streams_db.js";
import { verifyAccess } from "./common_jwt.js";
import { audit } from "./local/audit.js";
import { clipLive, clipRecording, finalizeRecording, removeRecordingFiles, setMediaRecord, wantsRecording } from "./streams_library.js";

const streamIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keyPattern = /^[a-f0-9]{48}$/;

export function requireStreamer(req, res, next) {
  const token = req.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  try {
    const decoded = verifyAccess(token);
    req.userId = decoded.sub;
    req.operator = decoded.operator === true ||
      (Boolean(process.env.OPERATOR_USER_ID) && decoded.sub === process.env.OPERATOR_USER_ID);
    if (!/^[a-f0-9]{24}$/.test(req.userId)) throw new Error("Invalid account ID.");
  } catch {
    return res.status(401).json({ error: "Sign in to manage streams." });
  }
  next();
}

async function withStreamUpdate(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function startStream(req, res) {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title || title.length > 120) return res.status(400).json({ error: "Enter a title of 1–120 characters." });
  const source = req.body?.source ?? "obs";
  if (source !== "browser" && source !== "obs") return res.status(400).json({ error: "Invalid broadcast source." });
  if (source === "obs" && !req.operator) {
    return res.status(403).json({ error: "Use browser sharing to start your stream." });
  }

  const id = randomUUID();
  const streamKey = randomBytes(24).toString("hex");
  const record = wantsRecording(req.body?.record);
  let stream;
  try {
    stream = await withStreamUpdate(async (client) => {
      const { rows: [created] } = await client.query(
        "INSERT INTO streams (id, user_id, title, stream_key, source, record) VALUES ($1,$2,$3,$4,$5,$6) RETURNING started_at",
        [id, req.userId, title, streamKey, source, record]
      );
      await audit("stream.created", req.userId, id);
      return created;
    });
  } catch (error) {
    if (error.constraint === "one_browser_stream_per_account") {
      return res.status(409).json({ error: "End your existing browser broadcast before starting another." });
    }
    throw error;
  }
  if (!record) {
    try {
      await setMediaRecord(id, false);
    } catch {
      await pool.query("DELETE FROM streams WHERE id = $1", [id]);
      return res.status(502).json({ error: "Recording could not be turned off. Start the broadcast again." });
    }
  }
  return res.set("Cache-Control", "no-store").status(201).json({ id, title, streamKey, source, record, startedAt: stream.started_at });
}

export async function setStreamRecording(req, res) {
  const id = req.body?.id;
  if (typeof id !== "string" || !streamIdPattern.test(id) || typeof req.body?.record !== "boolean") {
    return res.status(400).json({ error: "Choose a broadcast and say whether to record it." });
  }
  const { rows: [stream] } = await pool.query(
    "SELECT id FROM streams WHERE id = $1 AND user_id = $2 AND ended_at IS NULL",
    [id, req.userId]
  );
  if (!stream) return res.status(404).json({ error: "That broadcast is not live." });
  try {
    await setMediaRecord(id, req.body.record);
  } catch {
    return res.status(502).json({ error: "The media server could not change recording." });
  }
  await pool.query("UPDATE streams SET record = $2 WHERE id = $1", [id, req.body.record]);
  return res.json({ ok: true, id, record: req.body.record });
}

async function disconnectEncoder(id, source) {
  const endpoint = process.env.MEDIA_CONTROL_URL;
  if (!endpoint) return;
  const resource = source === "browser" ? "webrtcsessions" : "rtmpconns";
  const media = await fetch(new URL(`/v3/${resource}/list?itemsPerPage=10000`, endpoint), {
    signal: AbortSignal.timeout(3000)
  });
  if (!media.ok) throw new Error("Could not list encoder sessions.");
  const { items } = await media.json();
  const publisher = items.find((connection) => connection.path === id && connection.state === "publish");
  if (!publisher) return;
  const kick = await fetch(new URL(`/v3/${resource}/kick/${publisher.id}`, endpoint), {
    method: "POST", signal: AbortSignal.timeout(3000)
  });
  if (!kick.ok && kick.status !== 404) throw new Error("Could not disconnect encoder.");
}

export async function endStream(req, res) {
  const id = req.body?.id;
  if (typeof id !== "string" || !streamIdPattern.test(id)) return res.status(400).json({ error: "Invalid stream ID." });
  const stream = await withStreamUpdate(async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id, user_id, title, source, record, ended_at FROM streams
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, req.userId]
    );
    if (existing && !existing.ended_at) {
      await client.query("UPDATE streams SET ended_at = NOW() WHERE id = $1", [id]);
      await audit("stream.ended", req.userId, id);
    }
    return existing;
  });
  if (!stream) return res.status(404).json({ error: "Stream not found." });

  try {
    await disconnectEncoder(id, stream.source);
  } catch {
    return res.status(502).json({ error: "Broadcast is closed to viewers. Retry if the encoder is still connected." });
  }
  let recording = null;
  if (stream.record) {
    try {
      recording = await finalizeRecording(stream);
    } catch {
      return res.status(502).json({ error: "The broadcast ended, but the recording is not ready yet. Retry in a few seconds." });
    }
  }
  return res.json({ ok: true, id, recording });
}

export async function authorizeMedia(req, res) {
  const { path, action, protocol, query, token } = req.body || {};
  if (typeof path !== "string" || !streamIdPattern.test(path)) return res.sendStatus(403);
  if (action === "playback") {
    const { rows } = await pool.query("SELECT 1 FROM streams WHERE id = $1", [path]);
    return res.sendStatus(rows.length ? 204 : 403);
  }
  const publish = action === "publish" && ["rtmp", "webrtc"].includes(protocol);
  const read = action === "read" && ["hls", "webrtc"].includes(protocol);
  if (!publish && !read) return res.sendStatus(403);

  const { rows: [stream] } = await pool.query(
    `SELECT stream_key, source FROM streams WHERE id = $1 AND ended_at IS NULL
     AND (source IS NOT NULL OR user_id = $2)`, [path, process.env.OPERATOR_USER_ID ?? null]
  );
  if (!stream) return res.sendStatus(403);
  if (!publish) return res.sendStatus(204);
  if ((stream.source === "browser") !== (protocol === "webrtc")) return res.sendStatus(403);

  const key = protocol === "webrtc" ? token : new URLSearchParams(typeof query === "string" ? query : "").get("key");
  if (typeof key !== "string" || !keyPattern.test(key) || !keyPattern.test(stream.stream_key) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(stream.stream_key))) return res.sendStatus(403);
  return res.sendStatus(204);
}

export async function listStreams(_req, res) {
  const { rows } = await pool.query(
    `SELECT id, title, started_at AS "startedAt" FROM streams
     WHERE ended_at IS NULL AND (source IS NOT NULL OR user_id = $1)
     ORDER BY started_at DESC`, [process.env.OPERATOR_USER_ID ?? null]
  );
  const endpoint = process.env.MEDIA_CONTROL_URL;
  if (!endpoint || rows.length === 0) return res.json({ streams: endpoint ? [] : rows });

  try {
    const response = await fetch(new URL("/v3/paths/list?itemsPerPage=10000", endpoint), {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) throw new Error("Media status unavailable.");
    const { items } = await response.json();
    const publishing = new Set(items.filter((path) => path.ready).map((path) => path.name));
    return res.json({ streams: rows.filter(({ id }) => publishing.has(id)) });
  } catch {
    return res.json({ streams: [] });
  }
}

export async function manageStreams(req, res) {
  const { rows } = await pool.query(
    `SELECT id, title, COALESCE(source, 'obs') AS source, record,
       CASE WHEN source = 'browser' THEN NULL ELSE stream_key END AS "streamKey"
     FROM streams WHERE ended_at IS NULL AND user_id = $1 ORDER BY started_at DESC`, [req.userId]
  );
  res.set("Cache-Control", "no-store").json({ streams: rows });
}

function readerId(req) {
  const token = req.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  try { return verifyAccess(token).sub; } catch { return null; }
}

export async function listRecordings(req, res) {
  const userId = readerId(req);
  const { rows } = await pool.query(
    `SELECT id, stream_id AS "streamId", title, started_at AS "startedAt", ended_at AS "endedAt",
       duration_ms AS "durationMs", playback_start AS "playbackStart", duration_seconds AS "durationSeconds",
       ($1::text IS NOT NULL AND user_id = $1) AS owned
     FROM recordings ORDER BY started_at DESC LIMIT 100`,
    [userId]
  );
  res.json({ recordings: rows });
}

export async function deleteRecording(req, res) {
  const { rows: [recording] } = await pool.query(
    "SELECT id, stream_id, user_id FROM recordings WHERE id = $1",
    [req.params.id]
  );
  if (!recording) return res.status(404).json({ error: "That recording was not found." });
  if (recording.user_id !== req.userId) return res.status(403).json({ error: "You can delete only your own recordings." });
  await removeRecordingFiles(recording);
  await pool.query("DELETE FROM recordings WHERE id = $1", [recording.id]);
  return res.json({ ok: true, id: recording.id });
}

export async function listClips(req, res) {
  const userId = readerId(req);
  const { rows } = await pool.query(
    `SELECT id, title, duration_ms AS "durationMs", created_at AS "createdAt",
       ($1::text IS NOT NULL AND user_id = $1) AS owned
     FROM clips ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  res.json({ clips: rows });
}

export async function getClip(req, res) {
  const { rows: [clip] } = await pool.query(
    `SELECT id, title, duration_ms AS "durationMs", created_at AS "createdAt"
     FROM clips WHERE id = $1`,
    [req.params.id]
  );
  if (!clip) return res.status(404).json({ error: "That clip was not found." });
  return res.json({ ...clip, url: `/clips/${clip.id}.mp4` });
}

export async function createClip(req, res) {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (title.length > 120) return res.status(400).json({ error: "Enter a title of at most 120 characters." });
  try {
    const clip = req.body?.recordingId
      ? await clipRecording(req.userId, req.body.recordingId, req.body.startMs, req.body.endMs, title)
      : await clipLive(req.userId, req.body?.streamId, req.body?.seconds === 60 ? 60 : 30, title);
    return res.status(201).json(clip);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("[streams] clip failed", error.message);
    return res.status(status).json({ error: status === 500 ? "Could not cut that clip." : error.message });
  }
}
