import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const directory = join(homedir(), ".pulseplay-local");
const lines = readFileSync(join(directory, "operator.txt"), "utf8").trim().split("\n");
const emailOrUsername = lines[0].slice("Username: ".length);
const password = lines[1].slice("Password: ".length);
const base = "http://127.0.0.1:4173";
const title = "PulsePlay local test feed";

async function api(path, body, token) {
  return fetch(`${base}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { "Content-Type": "application/json" })
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
}

const login = await api("auth/login", { emailOrUsername, password });
assert.equal(login.status, 200);
const { accessToken, user } = await login.json();
assert.equal(user.operator, true);
const managed = await api("stream/manage", undefined, accessToken);
assert.equal(managed.status, 200);
const { streams } = await managed.json();
let stream = streams.find((item) => item.title === title);
if (!stream) {
  const start = await api("stream/start", { title }, accessToken);
  assert.equal(start.status, 201);
  stream = await start.json();
}
const publicList = await api("streams");
const listed = (await publicList.json()).streams.find((item) => item.id === stream.id);
if (listed) assert.equal(listed.streamKey, undefined);
assert.equal((await api("stream/start", { title: "Unauthorized" })).status, 401);
const encoder = `rtmp://127.0.0.1:1935/${stream.id}?key=${stream.streamKey}`;
writeFileSync(join(directory, "encoder.url"), encoder + "\n", { mode: 0o600 });
console.log(`${base}/${stream.id}/index.m3u8`);
