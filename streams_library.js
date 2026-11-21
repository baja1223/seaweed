import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./streams_db.js";

const recordingsDir = process.env.RECORDINGS_DIR || join(process.cwd(), "media/recordings");
const clipsDir = process.env.CLIPS_DIR || join(process.cwd(), "media/clips");
const playbackUrl = process.env.MEDIA_PLAYBACK_URL || "http://media:9996";
const controlUrl = process.env.MEDIA_CONTROL_URL || "";

export function wantsRecording(value) {
  return value !== false && value !== "false";
}

async function mediaJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  return { response, text };
}

export async function setMediaRecord(id, record) {
  if (!controlUrl) return;
  const body = JSON.stringify({
    source: "publisher",
    record,
    recordPath: "/recordings/%path/%Y-%m-%d_%H-%M-%S-%f_%z",
    recordFormat: "fmp4",
    recordPartDuration: "1s",
    recordSegmentDuration: "2s",
    recordDeleteAfter: "0s",
    overridePublisher: false,
    runOnRecordSegmentCreate: "chmod -R a+rwx /recordings/$MTX_PATH"
  });
  const headers = { "content-type": "application/json" };
  const patch = await mediaJson(new URL(`/v3/config/paths/patch/${id}`, controlUrl), { method: "PATCH", headers, body });
  if (patch.response.ok) return;
  const add = await mediaJson(new URL(`/v3/config/paths/add/${id}`, controlUrl), { method: "POST", headers, body });
  if (!add.response.ok) throw new Error(add.text.slice(0, 180) || "MediaMTX rejected the recording change.");
}

export async function listSegments(streamId) {
  const url = new URL("/list", playbackUrl);
  url.searchParams.set("path", streamId);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (response.status === 404 || response.status === 400) return [];
  if (!response.ok) throw new Error("The playback server could not list this recording.");
  const entries = await response.json();
  return Array.isArray(entries) ? entries : [];
}

function span(entries) {
  const start = entries[0].start;
  const durationSeconds = entries.reduce((total, entry) => total + Number(entry.duration), 0);
  const startedAt = new Date(start);
  return {
    playbackStart: start,
    durationSeconds,
    durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationSeconds * 1000)
  };
}

async function saveRecording(stream, entries) {
  if (!entries.length) return null;
  const times = span(entries);
  const path = `recordings/${stream.id}`;
  const { rows: [row] } = await pool.query(
    `INSERT INTO recordings
       (id, stream_id, user_id, title, started_at, ended_at, duration_ms, playback_start, duration_seconds, path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (stream_id) DO UPDATE SET
       ended_at = EXCLUDED.ended_at,
       duration_ms = EXCLUDED.duration_ms,
       playback_start = EXCLUDED.playback_start,
       duration_seconds = EXCLUDED.duration_seconds
     RETURNING id, stream_id AS "streamId", title, started_at AS "startedAt", ended_at AS "endedAt",
       duration_ms AS "durationMs", playback_start AS "playbackStart", duration_seconds AS "durationSeconds"`,
    [randomUUID(), stream.id, stream.user_id, stream.title, times.startedAt, times.endedAt,
      times.durationMs, times.playbackStart, times.durationSeconds, path]
  );
  return row;
}

export async function finalizeRecording(stream) {
  if (!stream?.record) return null;
  let entries = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    entries = await listSegments(stream.id);
    if (entries.length) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return saveRecording(stream, entries);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(log.slice(-400) || `ffmpeg exited ${code}`));
    });
  });
}

async function cutClip({ streamId, start, durationSeconds, title, userId, recordingId, startMs }) {
  await mkdir(clipsDir, { recursive: true });
  const id = randomUUID();
  const file = join(clipsDir, `${id}.mp4`);
  const source = new URL("/get", playbackUrl);
  source.searchParams.set("path", streamId);
  source.searchParams.set("start", start);
  source.searchParams.set("duration", String(durationSeconds));
  source.searchParams.set("format", "mp4");
  await runFfmpeg([
    "-y", "-i", source.toString(),
    "-t", String(durationSeconds),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    "-c:a", "aac", "-movflags", "+faststart",
    file
  ]);
  const info = await stat(file);
  if (info.size < 100) throw new Error("The clip file was empty.");
  const durationMs = Math.round(durationSeconds * 1000);
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (id, recording_id, stream_id, user_id, title, start_ms, duration_ms, path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, title, duration_ms AS "durationMs", created_at AS "createdAt"`,
    [id, recordingId, streamId, userId, title, startMs, durationMs, `clips/${id}.mp4`]
  );
  return clip;
}

export async function clipLive(userId, streamId, seconds, title) {
  const { rows: [stream] } = await pool.query(
    `SELECT id, user_id, title, record FROM streams WHERE id = $1 AND ended_at IS NULL AND record = TRUE`,
    [streamId]
  );
  if (!stream) {
    const error = new Error("That broadcast is not live or is not being recorded.");
    error.status = 404;
    throw error;
  }
  const entries = await listSegments(streamId);
  if (!entries.length) {
    const error = new Error("Nothing has been recorded yet. Wait a few seconds and try again.");
    error.status = 409;
    throw error;
  }
  const times = span(entries);
  const durationSeconds = Math.min(seconds, times.durationSeconds);
  if (durationSeconds < 1) {
    const error = new Error("The recording is shorter than a second.");
    error.status = 409;
    throw error;
  }
  const saved = await saveRecording(stream, entries);
  const startMs = Math.max(0, Math.round((times.durationSeconds - durationSeconds) * 1000));
  const start = new Date(new Date(times.playbackStart).getTime() + startMs).toISOString();
  return cutClip({
    streamId,
    start,
    durationSeconds,
    title: title || `${stream.title} clip`,
    userId,
    recordingId: saved.id,
    startMs
  });
}

export async function clipRecording(userId, recordingId, startMs, endMs, title) {
  const durationMs = endMs - startMs;
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || durationMs < 1000 || durationMs > 60000) {
    const error = new Error("Choose a clip from 1 to 60 seconds.");
    error.status = 400;
    throw error;
  }
  const { rows: [recording] } = await pool.query(
    `SELECT id, stream_id, title, duration_ms, playback_start FROM recordings WHERE id = $1`,
    [recordingId]
  );
  if (!recording) {
    const error = new Error("That recording was not found.");
    error.status = 404;
    throw error;
  }
  if (endMs > recording.duration_ms + 500) {
    const error = new Error("That range goes past the end of the recording.");
    error.status = 400;
    throw error;
  }
  const start = new Date(new Date(recording.playback_start).getTime() + startMs).toISOString();
  return cutClip({
    streamId: recording.stream_id,
    start,
    durationSeconds: durationMs / 1000,
    title: title || `${recording.title} clip`,
    userId,
    recordingId: recording.id,
    startMs
  });
}

export async function removeRecordingFiles(recording) {
  const { rows } = await pool.query("SELECT path FROM clips WHERE recording_id = $1", [recording.id]);
  await Promise.all(rows.map((row) => rm(join(clipsDir, row.path.slice("clips/".length)), { force: true })));
  await rm(join(recordingsDir, recording.stream_id), { recursive: true, force: true });
}
