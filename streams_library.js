import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
  const saved = await saveRecording(stream, entries);
  if (!saved) return null;
  await renderFinalOnce(saved);
  return { ...saved, url: recordingUrl(saved.streamId) };
}

const rendering = new Map();

export function recordingUrl(streamId) {
  return `/recordings/${streamId}/final.mp4`;
}

function finalFile(streamId) {
  return join(recordingsDir, streamId, "final.mp4");
}

function segmentPaths(names, streamId) {
  return names
    .filter((name) => name.endsWith(".mp4") && !name.startsWith("final"))
    .sort()
    .map((name) => join(recordingsDir, streamId, name));
}

async function segmentFiles(streamId) {
  try {
    return segmentPaths(await readdir(join(recordingsDir, streamId)), streamId);
  } catch {
    return [];
  }
}

function concatLine(file) {
  return `file '${file.replaceAll("'", `'\\''`)}'`;
}

async function writeConcatList(streamId, files) {
  const list = join(recordingsDir, streamId, "concat.txt");
  await writeFile(list, `${files.map(concatLine).join("\n")}\n`);
  return list;
}

async function playedDuration(file) {
  let data;
  try {
    data = JSON.parse(await runCommand("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,duration",
      "-of", "json",
      file
    ]));
  } catch {
    return 0;
  }
  const video = (data.streams || []).find((stream) => stream.codec_type === "video");
  const videoDuration = Number(video?.duration);
  if (Number.isFinite(videoDuration) && videoDuration > 0) return videoDuration;
  const formatDuration = Number(data.format?.duration);
  return Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : 0;
}

async function segmentSet(streamId) {
  const candidates = await segmentFiles(streamId);
  const readable = [];
  for (const file of candidates) {
    const duration = await playedDuration(file);
    if (duration > 0) readable.push({ file, duration });
  }
  const chosen = readable.length ? readable : candidates.map((file) => ({ file, duration: 0 }));
  return {
    files: chosen.map((item) => item.file),
    total: chosen.reduce((sum, item) => sum + item.duration, 0)
  };
}

function covers(duration, total) {
  return total > 0 && duration >= total * 0.8;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(log.trim());
      else reject(new Error(log.slice(-400) || `${command} exited ${code}`));
    });
  });
}

function runFfmpeg(args) {
  return runCommand("ffmpeg", args);
}

async function audioCodec(input) {
  try {
    const codec = await runCommand("ffprobe", [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name", "-of", "csv=p=0", input
    ]);
    return codec.split("\n")[0].trim();
  } catch {
    return "";
  }
}

function audioArgs(codec) {
  if (codec === "none") return ["-an"];
  if (codec === "aac") return ["-c:a", "copy"];
  return ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"];
}

async function writeProgressive({ input, audio, file, before = [], after = [], video = "auto" }) {
  const encoded = audio[0] === "-an" ? ["-an"] : ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"];
  const copy = ["-c:v", "copy", ...audio];
  const transcode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", ...encoded];
  const silent = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-an"];
  const attempts = video === "encode" ? [transcode, silent] : [copy, transcode, silent];
  let last;
  for (const args of attempts) {
    try {
      await runFfmpeg(["-y", ...before, "-i", input, ...after, ...args, "-movflags", "+faststart", file]);
      return;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

async function writeJoined({ streamId, files, file, startSeconds = 0, durationSeconds = 0, video = "auto" }) {
  const list = await writeConcatList(streamId, files);
  const codec = await audioCodec(files[0]);
  const after = [];
  if (startSeconds > 0) after.push("-ss", String(startSeconds));
  if (durationSeconds > 0) after.push("-t", String(durationSeconds));
  try {
    await writeProgressive({
      input: list,
      audio: audioArgs(codec),
      file,
      before: ["-f", "concat", "-safe", "0"],
      after,
      video
    });
  } finally {
    await rm(list, { force: true });
  }
}

async function segmentStamp(files) {
  const lines = [];
  for (const file of files) {
    const info = await stat(file);
    lines.push(`${file} ${info.size}`);
  }
  return lines.join("\n");
}

async function renderFinal(recording) {
  const streamId = recording.streamId || recording.stream_id;
  const target = finalFile(streamId);
  const stampFile = join(recordingsDir, streamId, "final.stamp");
  const { files, total } = await segmentSet(streamId);
  if (!files.length) throw new Error("This recording has no segments.");
  const stamp = await segmentStamp(files);
  let saved = "";
  try {
    saved = await readFile(stampFile, "utf8");
  } catch {
    saved = "";
  }
  const current = await playedDuration(target);
  if (covers(current, total) || (saved === stamp && current > 0)) return target;
  await mkdir(join(recordingsDir, streamId), { recursive: true });
  const partial = join(recordingsDir, streamId, "final.part.mp4");
  let duration = 0;
  try {
    await writeJoined({ streamId, files, file: partial });
    duration = await playedDuration(partial);
    if (total > 0 && !covers(duration, total)) {
      await writeJoined({ streamId, files, file: partial, video: "encode" });
      duration = await playedDuration(partial);
    }
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  if (duration + 0.25 < current) {
    await rm(partial, { force: true });
    throw new Error(`Joined recording is ${duration.toFixed(2)}s and the pieces total ${total.toFixed(2)}s.`);
  }
  await rename(partial, target);
  await writeFile(stampFile, stamp);
  if (total > 0 && !covers(duration, total)) {
    console.error(`[streams] joined recording ${streamId} is ${duration.toFixed(2)}s and the pieces total ${total.toFixed(2)}s`);
  }
  await pool.query("UPDATE recordings SET path = $2 WHERE stream_id = $1", [streamId, `recordings/${streamId}/final.mp4`]);
  return target;
}

function renderFinalOnce(recording) {
  const streamId = recording.streamId || recording.stream_id;
  if (!rendering.has(streamId)) {
    const pending = renderFinal(recording).finally(() => rendering.delete(streamId));
    rendering.set(streamId, pending);
  }
  return rendering.get(streamId);
}

async function rewriteClipIfShort(clip) {
  const file = join(clipsDir, `${clip.id}.mp4`);
  const mark = join(clipsDir, `${clip.id}.stamp`);
  const expected = Number(clip.duration_ms) / 1000;
  const current = await playedDuration(file);
  if (!(expected > 0) || covers(current, expected)) return;
  let marked = "";
  try {
    marked = await readFile(mark, "utf8");
  } catch {
    marked = "";
  }
  if (marked === String(clip.duration_ms)) return;
  await renderFinalOnce({ stream_id: clip.stream_id });
  const partial = join(clipsDir, `${clip.id}.part.mp4`);
  try {
    await writeProgressive({
      input: finalFile(clip.stream_id),
      audio: ["-c:a", "copy"],
      file: partial,
      before: ["-ss", String(Number(clip.start_ms) / 1000)],
      after: ["-t", String(expected)]
    });
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  const duration = await playedDuration(partial);
  if (duration < current + 0.5) {
    await rm(partial, { force: true });
    await writeFile(mark, String(clip.duration_ms));
    return;
  }
  await rm(mark, { force: true });
  await rename(partial, file);
}

export async function backfillRecordings() {
  const { rows } = await pool.query("SELECT stream_id FROM recordings");
  for (const row of rows) {
    try {
      await renderFinalOnce(row);
    } catch (error) {
      console.error("[streams] recording backfill failed", row.stream_id, error.message);
    }
  }
  const clips = await pool.query("SELECT id, stream_id, start_ms, duration_ms FROM clips");
  for (const clip of clips.rows) {
    try {
      await rewriteClipIfShort(clip);
    } catch (error) {
      console.error("[streams] clip backfill failed", clip.id, error.message);
    }
  }
}

function sendVideo(res, file) {
  res.sendFile(file, { acceptRanges: true }, (error) => {
    if (error && !res.headersSent) res.sendStatus(error.statusCode || 404);
  });
}

export async function sendRecordingFile(req, res) {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.sendStatus(404);
  const { rows: [recording] } = await pool.query(
    `SELECT stream_id, playback_start, duration_seconds FROM recordings WHERE stream_id = $1`,
    [id]
  );
  if (!recording) return res.sendStatus(404);
  try {
    await renderFinalOnce(recording);
  } catch (error) {
    console.error("[streams] final mp4 failed", error.message);
    return res.status(500).json({ error: "The recording is not ready to play yet." });
  }
  return sendVideo(res, finalFile(id));
}

export function sendClipFile(req, res) {
  if (!/^[0-9a-f-]{36}\.mp4$/.test(req.params.name)) return res.sendStatus(404);
  return sendVideo(res, join(clipsDir, req.params.name));
}

async function insertClip({ file, title, userId, recordingId, streamId, startMs, durationSeconds }) {
  const info = await stat(file);
  if (info.size < 100) throw new Error("The clip file was empty.");
  const id = file.slice(file.lastIndexOf("/") + 1, -4);
  const durationMs = Math.max(1, Math.round(durationSeconds * 1000));
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (id, recording_id, stream_id, user_id, title, start_ms, duration_ms, path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, title, duration_ms AS "durationMs", created_at AS "createdAt"`,
    [id, recordingId, streamId, userId, title, startMs, durationMs, `clips/${id}.mp4`]
  );
  return clip;
}

async function cutClip({ streamId, durationSeconds, title, userId, recordingId, startMs }) {
  await mkdir(clipsDir, { recursive: true });
  const id = randomUUID();
  const file = join(clipsDir, `${id}.mp4`);
  const { files, total } = await segmentSet(streamId);
  if (!files.length) throw new Error("This recording has no segments.");
  await writeJoined({
    streamId,
    files,
    file,
    startSeconds: startMs / 1000,
    durationSeconds
  });
  const duration = await playedDuration(file);
  if (total > 0 && duration + 0.25 < Math.min(durationSeconds, total) * 0.8) {
    await writeJoined({
      streamId,
      files,
      file,
      startSeconds: startMs / 1000,
      durationSeconds,
      video: "encode"
    });
  }
  return insertClip({ file, title, userId, recordingId, streamId, startMs, durationSeconds });
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
  return cutClip({
    streamId,
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
  const clipTitle = title || `${recording.title} clip`;
  const durationSeconds = durationMs / 1000;
  await mkdir(clipsDir, { recursive: true });
  const id = randomUUID();
  const file = join(clipsDir, `${id}.mp4`);
  await renderFinalOnce(recording);
  const { files } = await segmentSet(recording.stream_id);
  try {
    await writeProgressive({
      input: finalFile(recording.stream_id),
      audio: ["-c:a", "copy"],
      file,
      before: ["-ss", String(startMs / 1000)],
      after: ["-t", String(durationSeconds)]
    });
    const duration = await playedDuration(file);
    if (duration + 0.25 < durationSeconds * 0.8) throw new Error("Clip is shorter than the requested range.");
  } catch {
    await rm(file, { force: true });
    if (!files.length) throw new Error("This recording has no segments.");
    await writeJoined({
      streamId: recording.stream_id,
      files,
      file,
      startSeconds: startMs / 1000,
      durationSeconds,
      video: "encode"
    });
  }
  return insertClip({
    file, title: clipTitle, userId, recordingId: recording.id, streamId: recording.stream_id, startMs, durationSeconds
  });
}

export async function removeClipFile(clip) {
  const name = clip.path?.startsWith("clips/") ? clip.path.slice("clips/".length) : `${clip.id}.mp4`;
  await rm(join(clipsDir, name), { force: true });
  if (name.endsWith(".mp4")) await rm(join(clipsDir, `${name.slice(0, -4)}.stamp`), { force: true });
  await rm(join(clipsDir, `${clip.id}.part.mp4`), { force: true });
}

export async function removeRecordingFiles(recording) {
  const { rows } = await pool.query("SELECT id, path FROM clips WHERE recording_id = $1", [recording.id]);
  await Promise.all(rows.map((row) => removeClipFile(row)));
  await rm(join(recordingsDir, recording.stream_id), { recursive: true, force: true });
}
