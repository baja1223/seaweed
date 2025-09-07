const AUTH_URL = "http://localhost:4000/api/auth";
const CHAT_URL = "ws://localhost:4001";
const STREAMS_URL = "http://localhost:4002/api";

let accessToken = null;
let refreshToken = null;
let user = null;
let ws = null;
let currentStreamId = null;

const $ = (id) => document.getElementById(id);
const authStatus = $("authStatus");

function setStatus(txt) { authStatus.textContent = txt; }

// quick demo: register or login a fixed dev user
async function devEnsureUser() {
  const u = { username: "demo", email: "demo@example.com", password: "Demo123!" };
  let r = await fetch(`${AUTH_URL}/register`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(u) });
  if (!r.ok) {
    // likely exists, try login
    r = await fetch(`${AUTH_URL}/login`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ emailOrUsername: u.email, password: u.password }) });
  }
  const data = await r.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  user = data.user;
  setStatus(`signed in as ${user.username} (author: ${user.author})`);
}

function connectChat(room) {
  if (!accessToken) return alert("Sign-in first.");
  if (ws) try { ws.close(); } catch {}
  ws = new WebSocket(`${CHAT_URL}/?room=${encodeURIComponent(room)}&token=${encodeURIComponent(accessToken)}`);
  const history = $("history");
  history.innerHTML = "";

  ws.onmessage = (ev) => {
    const payload = JSON.parse(ev.data);
    if (payload.type === "history") {
      payload.data.forEach(renderMsg);
    } else if (payload.type === "message") {
      renderMsg(payload);
    }
  };

  ws.onopen = () => appendInfo(`joined room: ${room}`);
  ws.onclose = () => appendInfo(`left room`);
}

function appendInfo(text) {
  const history = $("history");
  const div = document.createElement("div");
  div.style.color = "#9aa7ff";
  div.textContent = text;
  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
}

function renderMsg(msg) {
  const history = $("history");
  const div = document.createElement("div");
  const ts = new Date(msg.ts || Date.now()).toLocaleTimeString();
  div.textContent = `[${ts}] ${msg.user?.username || "anon"}: ${msg.text}`;
  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
}

$("join").onclick = () => connectChat($("room").value || "lobby");
$("send").onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const text = $("msg").value.trim();
  if (!text) return;
  ws.send(text);
  $("msg").value = "";
};

$("startBtn").onclick = async () => {
  const title = $("streamTitle").value || "My Stream";
  const r = await fetch(`${STREAMS_URL}/stream/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": user?.id || "demo"
    },
    body: JSON.stringify({ title })
  });
  const data = await r.json();
  currentStreamId = data.id;
  $("streamKeyBox").textContent = `Stream Key: ${data.streamKey}\nUse in OBS as rtmp://localhost/live/${data.streamKey}`;
};

$("endBtn").onclick = async () => {
  if (!currentStreamId) return alert("No active stream");
  await fetch(`${STREAMS_URL}/stream/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentStreamId })
  });
  $("streamKeyBox").textContent = "Stream ended.";
  currentStreamId = null;
};

$("refreshStreams").onclick = async () => {
  const r = await fetch(`${STREAMS_URL}/streams`);
  const data = await r.json();
  const ul = $("streamsList");
  ul.innerHTML = "";
  data.streams.forEach(s => {
    const li = document.createElement("li");
    li.textContent = `${s.title} — viewers: ${s.viewerCount}`;
    ul.appendChild(li);
  });
};

// Pretend player: for real HLS, in Phase 2 set src to your /manifest.m3u8 via hls.js
document.addEventListener("DOMContentLoaded", async () => {
  await devEnsureUser();
  connectChat("lobby");
  $("refreshStreams").click();
});
