import { spawn } from "node:child_process";

const authUrl = process.env.AUTH_URL || "http://127.0.0.1:4000";
const chatHealthUrl = process.env.CHAT_HEALTH_URL || "http://127.0.0.1:4001";
const chatUrl = process.env.CHAT_URL || "ws://127.0.0.1:4173/ws";
const streamsUrl = process.env.STREAMS_URL || "http://127.0.0.1:4002";
const contentUrl = process.env.CONTENT_URL || "http://127.0.0.1:4003";
const frontendUrl = process.env.FRONTEND_URL || "http://127.0.0.1:4173";

const stamp = Date.now().toString(36);
const user = {
  username: `demo${stamp}`.slice(0, 32),
  email: `demo${stamp}@example.com`,
  password: "Demo123!"
};

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkHealth() {
  for (const [name, url] of [
    ["auth", `${authUrl}/health`],
    ["chat", `${chatHealthUrl}/health`],
    ["streams", `${streamsUrl}/health`],
    ["content", `${contentUrl}/health`],
    ["frontend", `${frontendUrl}/health`]
  ]) {
    const { response, body } = await json(url);
    assert(response.ok && body?.ok === true && body.service === name, `${name} health: ${response.status} ${JSON.stringify(body)}`);
    console.log(`ok  ${name} health`);
  }
}

async function checkAuth() {
  const registered = await json(`${frontendUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user)
  });
  assert(registered.response.status === 201, `register ${registered.response.status} ${JSON.stringify(registered.body)}`);
  assert(registered.body.accessToken && registered.body.refreshToken, "register did not return tokens");
  assert(registered.body.user?.operator === false, "a public signup was marked as the operator");
  console.log("ok  register via frontend proxy");

  const loggedIn = await json(`${authUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: user.email, password: user.password })
  });
  assert(loggedIn.response.ok && loggedIn.body.accessToken, `login ${loggedIn.response.status}`);
  console.log("ok  login");

  const profile = await json(`${frontendUrl}/api/auth/profile`, {
    headers: { Authorization: `Bearer ${loggedIn.body.accessToken}` }
  });
  assert(profile.response.ok && profile.body.user?.username === user.username, `profile ${profile.response.status} ${JSON.stringify(profile.body)}`);
  console.log("ok  profile");
  return loggedIn.body.accessToken;
}

async function checkStreams(token) {
  const started = await json(`${streamsUrl}/api/stream/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Local ${stamp}`, source: "browser" })
  });
  assert(started.response.status === 201 && started.body.streamKey, `start stream ${started.response.status} ${JSON.stringify(started.body)}`);
  console.log("ok  stream start returned a key");

  const listed = await json(`${frontendUrl}/api/streams`);
  assert(listed.response.ok && !listed.body.streams?.some((stream) => stream.id === started.body.id), "a browser stream was listed before anything was publishing");
  console.log("ok  unpublished browser stream stays off the list");

  const denied = await json(`${frontendUrl}/api/stream/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Not operator ${stamp}` })
  });
  assert(denied.response.status === 403, `public OBS start should be forbidden, got ${denied.response.status}`);
  console.log("ok  public account cannot start an operator stream");
  return started.body;
}

async function checkOperator() {
  const username = process.env.OPERATOR_USERNAME || "operator";
  const password = process.env.OPERATOR_PASSWORD || "operator-local-change-me";
  const loggedIn = await json(`${frontendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: username, password })
  });
  assert(loggedIn.response.ok && loggedIn.body.user?.operator === true, `operator login ${loggedIn.response.status} ${JSON.stringify(loggedIn.body)}`);
  const byEmail = await json(`${frontendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.OPERATOR_EMAIL || "operator@example.com", password })
  });
  assert(byEmail.response.ok && byEmail.body.user?.operator === true, `operator email login ${byEmail.response.status}`);
  const mixedCase = username.slice(0, 1).toUpperCase() + username.slice(1);
  const byCase = await json(`${frontendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: mixedCase, password })
  });
  assert(byCase.response.ok, `operator case-insensitive login ${byCase.response.status} ${JSON.stringify(byCase.body)}`);
  const missing = await json(`${frontendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: `nobody-${stamp}`, password: "not-a-real-password" })
  });
  assert(missing.response.status === 401 && missing.body.reason === "no_such_user", `missing user ${missing.response.status} ${JSON.stringify(missing.body)}`);
  const wrong = await json(`${frontendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: username, password: "not-the-password" })
  });
  assert(wrong.response.status === 401 && wrong.body.reason === "wrong_password", `wrong password ${wrong.response.status} ${JSON.stringify(wrong.body)}`);
  const started = await json(`${frontendUrl}/api/stream/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loggedIn.body.accessToken}` },
    body: JSON.stringify({ title: `Operator ${stamp}` })
  });
  assert(started.response.status === 201 && started.body.streamKey, `operator stream ${started.response.status} ${JSON.stringify(started.body)}`);
  const listed = await json(`${frontendUrl}/api/streams`);
  assert(!listed.body.streams?.some((stream) => stream.id === started.body.id), "operator stream was listed before the encoder connected");
  console.log("ok  operator login and unpublished stream stays offline");
  return { token: loggedIn.body.accessToken, stream: started.body };
}

function connectChat(token, room) {
  const messages = [];
  const url = new URL(chatUrl);
  url.searchParams.set("room", room);
  url.searchParams.set("token", token);
  const socket = new WebSocket(url);
  let waiter = null;
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
    if (waiter?.predicate(messages)) {
      const resolve = waiter.resolve;
      waiter = null;
      resolve(messages);
    }
  });
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket connect timeout")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });
  function until(predicate, timeoutMs = 5000) {
    if (predicate(messages)) return Promise.resolve(messages);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error(`timed out; saw ${JSON.stringify(messages)}`));
      }, timeoutMs);
      waiter = {
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      };
    });
  }
  return { socket, opened, until, messages };
}

async function checkChat(token) {
  const room = `room-${stamp}`;
  const first = connectChat(token, room);
  await first.opened;
  await first.until((messages) => messages.some((payload) => payload.type === "history"));
  first.socket.send(`hello-${stamp}`);
  const echoed = await first.until((messages) => messages.some((payload) => payload.type === "message" && payload.text === `hello-${stamp}`));
  assert(echoed.at(-1).user?.username === user.username, "broadcast missing username");

  const second = connectChat(token, room);
  await second.opened;
  const replay = await second.until((messages) => messages.some((payload) => payload.type === "history" && payload.data?.some((item) => item.text === `hello-${stamp}`)));
  assert(replay.some((payload) => payload.type === "history" && payload.data.some((item) => item.text === `hello-${stamp}`)), "history did not include the first message");

  const live = second.until((messages) => messages.some((payload) => payload.type === "message" && payload.text === `again-${stamp}`));
  first.socket.send(`again-${stamp}`);
  await live;
  first.socket.close();
  second.socket.close();
  console.log("ok  chat broadcast and history via /ws");
}

async function checkContent(token) {
  const created = await json(`${frontendUrl}/api/content/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Clip ${stamp}`, authorId: user.username })
  });
  assert(created.response.status === 201 && created.body.item?.title === `Clip ${stamp}`, `content create ${created.response.status}`);
  const listed = await json(`${contentUrl}/api/content/items`);
  assert(listed.response.ok && listed.body.items?.some((item) => item.title === `Clip ${stamp}`), "content item missing from list");
  console.log("ok  content create and list");
}

async function checkPage() {
  const response = await fetch(frontendUrl);
  const html = await response.text();
  assert(response.ok, `frontend page ${response.status}`);
  for (const marker of ["loginForm", "registerForm", "history", "goLiveBtn", "cameraSelect", "streamsList", "nextClip"]) {
    assert(html.includes(marker), `page missing ${marker}`);
  }
  const script = await fetch(`${frontendUrl}/index.js`);
  assert(script.ok, "frontend script missing");
  const source = await script.text();
  assert(source.includes("/ws") && !source.includes(":4001") && !source.includes("127.0.0.1"), "page script still points at a fixed host or port");
  const clip = await fetch(`${frontendUrl}/standby/hamsters.mp4`);
  assert(clip.ok && (clip.headers.get("content-type") || "").includes("video"), `standby clip ${clip.status}`);
  console.log("ok  frontend page");
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

const composeBin = (await run("docker", ["info"])).code === 0 ? ["docker"] : ["sudo", "docker"];

function compose(args) {
  return run(composeBin[0], [...composeBin.slice(1), "compose", ...args]);
}

async function authorize(body) {
  return json(`${streamsUrl}/api/media/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: "127.0.0.1", user: "", password: "", id: "", query: "", userAgent: "check", ...body })
  });
}

async function checkPublish(token, stream) {
  const good = await authorize({ action: "publish", path: stream.id, protocol: "webrtc", token: stream.streamKey });
  assert(good.response.status === 204, `webrtc publish ${good.response.status}`);
  const bad = await authorize({ action: "publish", path: stream.id, protocol: "webrtc", token: "0".repeat(48) });
  assert(bad.response.status === 403, `bad stream key ${bad.response.status}`);
  const rtmp = await authorize({ action: "publish", path: stream.id, protocol: "rtmp", query: `key=${stream.streamKey}` });
  assert(rtmp.response.status === 403, `rtmp on a browser stream ${rtmp.response.status}`);
  const readWeb = await authorize({ action: "read", path: stream.id, protocol: "webrtc", token: "" });
  assert(readWeb.response.status === 204, `webrtc read ${readWeb.response.status}`);
  const readHls = await authorize({ action: "read", path: stream.id, protocol: "hls", token: "" });
  assert(readHls.response.status === 204, `hls read ${readHls.response.status}`);
  const whip = await fetch(`${frontendUrl}/${stream.id}/whip`, {
    method: "POST",
    headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${stream.streamKey}` },
    body: "v=0\r\n"
  });
  assert(![401, 502].includes(whip.status), `whip proxy ${whip.status}`);
  const ended = await json(`${frontendUrl}/api/stream/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: stream.id })
  });
  assert(ended.response.ok, `end browser stream ${ended.response.status} ${JSON.stringify(ended.body)}`);
  const closed = await authorize({ action: "publish", path: stream.id, protocol: "webrtc", token: stream.streamKey });
  assert(closed.response.status === 403, `publish after end ${closed.response.status}`);
  console.log("ok  publish auth accepts a stream key and rejects a bad or ended one");
}

async function waitUntil(label, predicate, timeoutMs = 25000) {
  const started = Date.now();
  let detail = "";
  while (Date.now() - started < timeoutMs) {
    detail = await predicate();
    if (detail === true) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} timed out (${detail})`);
}

async function playlistMedia(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok || !text.includes("#EXTM3U")) return { ok: false, detail: `${response.status} ${text.slice(0, 120)}` };
  const plain = text.split("\n").map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
  const line = plain || text.match(/URI="([^"]+)"/)?.[1];
  if (!line) return { ok: false, detail: "playlist has no media yet" };
  const next = new URL(line, url);
  if (next.pathname.endsWith(".m3u8")) return playlistMedia(next.href);
  const media = await fetch(next);
  if (!media.ok) return { ok: false, detail: `segment ${media.status}` };
  const bytes = Buffer.from(await media.arrayBuffer());
  return bytes.length > 100 ? true : { ok: false, detail: `segment is ${bytes.length} bytes` };
}

async function checkLive(operator) {
  const { id, streamKey } = operator.stream;
  const encoder = spawn(composeBin[0], [...composeBin.slice(1), "compose", "exec", "-T", "media",
    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-re",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-tune", "zerolatency", "-g", "15",
    "-c:a", "aac", "-b:a", "64k", "-t", "40",
    "-f", "flv", `rtmp://127.0.0.1:1935/${id}?key=${streamKey}`
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let encoderLog = "";
  encoder.stderr.on("data", (chunk) => { encoderLog += chunk; });
  try {
    await waitUntil("stream became live", async () => {
      const listed = await json(`${frontendUrl}/api/streams`);
      if (listed.body.streams?.some((stream) => stream.id === id)) return true;
      return encoder.exitCode === null ? "not listed yet" : `ffmpeg exited ${encoder.exitCode}: ${encoderLog.slice(-400)}`;
    });
    console.log("ok  publishing marks the stream live");
    await waitUntil("hls playlist", async () => {
      const media = await playlistMedia(`${frontendUrl}/${id}/index.m3u8`);
      return media === true ? true : media.detail;
    });
    console.log("ok  hls plays through port 4173");
  } finally {
    encoder.kill("SIGKILL");
    await compose(["exec", "-T", "media", "sh", "-c", "killall ffmpeg >/dev/null 2>&1 || true"]);
    const ended = await json(`${frontendUrl}/api/stream/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${operator.token}` },
      body: JSON.stringify({ id })
    });
    assert(ended.response.ok, `end live stream ${ended.response.status} ${JSON.stringify(ended.body)}`);
  }
  await waitUntil("stream went offline", async () => {
    const listed = await json(`${frontendUrl}/api/streams`);
    return listed.body.streams?.some((stream) => stream.id === id) ? "still listed" : true;
  });
  const playlist = await fetch(`${frontendUrl}/${id}/index.m3u8`);
  assert(!playlist.ok, `hls stayed available after the stream ended (${playlist.status})`);
  console.log("ok  ending the stream marks it offline");
}

try {
  await checkHealth();
  const token = await checkAuth();
  const operator = await checkOperator();
  const browserStream = await checkStreams(token);
  await checkPublish(token, browserStream);
  await checkLive(operator);
  await checkChat(token);
  await checkContent(token);
  await checkPage();
  if (process.exitCode) process.exit(process.exitCode);
  console.log("All checks passed.");
} catch (error) {
  fail(error?.stack || error?.message || error);
}
