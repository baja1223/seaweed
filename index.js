import { capture, connected, publish } from "./broadcast.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
let session;
let socket;
let player;
let selectedStream;
let playbackTimeout;
let standby = false;
const unplayableUntil = new Map();
let broadcast;
let pendingPreview = false;
let refreshRequest;

async function api(path, { body, authorized = false, retry = true } = {}) {
  const headers = {};
  if (authorized && session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/${path}`, {
    headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 401 && authorized && retry && session?.refreshToken) {
    const previous = session;
    refreshRequest ??= api("auth/refresh", { body: { refreshToken: previous.refreshToken } })
      .then((tokens) => { if (session === previous) Object.assign(session, tokens); })
      .finally(() => { refreshRequest = undefined; });
    await refreshRequest;
    if (session !== previous) throw new Error("Sign in again to manage broadcasts.");
    return api(path, { body, authorized, retry: false });
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function setAccount(data) {
  session = data;
  $("account").hidden = Boolean(session);
  $("logout").hidden = !session;
  $("studio").hidden = !session;
  $("operator").hidden = !session?.user.operator;
  $("authStatus").textContent = session
    ? `Signed in as ${session.user.username}${session.user.operator ? " (operator)" : ""}`
    : "Watching as guest";
  $("joinForm").hidden = !session;
  $("sendForm").hidden = !session;
  $("broadcasts").replaceChildren();
  $("studioBroadcasts").replaceChildren();
  if (session) {
    connectChat();
    refreshBroadcasts();
  } else {
    const oldSocket = socket;
    socket = undefined;
    oldSocket?.close();
    $("history").replaceChildren();
    $("chatStatus").textContent = "Sign in to join chat.";
  }
}

for (const action of ["login", "register"]) {
  $(`${action}Form`).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button");
    submit.disabled = true;
    $("accountStatus").textContent = "";
    try {
      const data = await api(`auth/${action}`, { body: Object.fromEntries(new FormData(form)) });
      form.reset();
      setAccount(data);
      $("logout").focus();
    } catch (error) {
      $("accountStatus").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

$("logout").addEventListener("click", async () => {
  $("logout").disabled = true;
  try {
    await stopBroadcast();
  } finally {
    $("logout").disabled = false;
  }
  setAccount(undefined);
  $("signIn").querySelector("summary").focus();
});

function connectChat() {
  if (!session) return;
  socket?.close();
  const room = $("room").value.trim() || "lobby";
  const params = new URLSearchParams({ room, token: session.accessToken });
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const connection = new WebSocket(`${protocol}//${location.host}/ws?${params}`);
  socket = connection;
  $("history").replaceChildren();
  $("chatStatus").textContent = `Joining ${room}…`;
  connection.onopen = () => { $("chatStatus").textContent = `Joined ${room}.`; };
  connection.onclose = () => {
    if (socket === connection) $("chatStatus").textContent = "Chat disconnected. Rejoin the room or sign in again.";
  };
  connection.onmessage = ({ data }) => {
    if (socket !== connection) return;
    const message = JSON.parse(data);
    const messages = message.type === "history" ? message.data : [message];
    for (const item of messages) {
      const line = document.createElement("div");
      line.textContent = `${item.user?.username || "Guest"}: ${item.text}`;
      $("history").append(line);
    }
    $("history").scrollTop = $("history").scrollHeight;
  };
}

$("joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  connectChat();
});
$("sendForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = $("msg").value.trim();
  if (!message || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(message);
  $("msg").value = "";
});

function clearPlayback() {
  clearTimeout(playbackTimeout);
  video.onerror = null;
  player?.destroy();
  player = undefined;
  if (video.hasAttribute("src")) {
    video.removeAttribute("src");
    video.load();
  }
}

function watchStandby() {
  if (standby) return;
  clearPlayback();
  selectedStream = undefined;
  standby = true;
  video.loop = true;
  $("standbyCredit").hidden = false;
  $("playerStatus").textContent = "No live stream is playing. Starting the standby film…";
  video.onerror = () => {
    $("playerStatus").textContent = "The standby film is unavailable. Use the YouTube link below.";
  };
  video.src = "/standby/big-buck-bunny.mp4";
  void video.play().catch(() => {});
}

function watch(stream) {
  clearPlayback();
  selectedStream = stream;
  standby = false;
  video.loop = false;
  $("standbyCredit").hidden = true;
  const source = `/${stream.id}/index.m3u8`;
  $("playerStatus").textContent = `Connecting to ${stream.title}…`;
  const fail = () => {
    if (selectedStream !== stream) return;
    unplayableUntil.set(stream.id, Date.now() + 30000);
    watchStandby();
  };
  video.onerror = fail;
  playbackTimeout = setTimeout(fail, 18000);
  if (window.Hls?.isSupported()) {
    player = new window.Hls();
    player.on(window.Hls.Events.ERROR, (_event, error) => {
      if (error.fatal) fail();
    });
    player.loadSource(source);
    player.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = source;
  } else {
    fail();
  }
}

video.addEventListener("canplay", () => {
  clearTimeout(playbackTimeout);
  if (video.autoplay) void video.play().catch(() => {
    $("playerStatus").textContent = "Select Play to begin watching.";
  });
});

video.addEventListener("playing", () => {
  if (standby) $("playerStatus").textContent = "Standby clip: Big Buck Bunny";
  else if (selectedStream) $("playerStatus").textContent = `Live: ${selectedStream.title}`;
});

let displayedStreamIds;
async function refreshStreams() {
  try {
    const { streams } = await api("streams");
    if (!streams.some(({ id }) => id === selectedStream?.id)) {
      const available = streams.find(({ id }) => (unplayableUntil.get(id) ?? 0) <= Date.now());
      if (available) watch(available);
      else watchStandby();
    }
    for (const id of unplayableUntil.keys()) {
      if (!streams.some((stream) => stream.id === id)) unplayableUntil.delete(id);
    }
    const ids = streams.map(({ id }) => id).join(",");
    if (displayedStreamIds === ids) return;
    displayedStreamIds = ids;
    const focusWasInList = $("streamsList").contains(document.activeElement);
    $("streamsList").replaceChildren(...streams.map((stream) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = `Watch ${stream.title}`;
      button.addEventListener("click", () => watch(stream));
      item.append(button);
      return item;
    }));
    if (focusWasInList) $("refreshStreams").focus();
  } catch {
    if (!selectedStream) watchStandby();
  }
}

async function refreshBroadcasts() {
  const activeSession = session;
  try {
    const { streams } = await api("stream/manage", { authorized: true });
    if (session !== activeSession) return;
    $("studioBroadcasts").replaceChildren(...streams.filter((stream) => stream.source === "browser").map((stream) => {
      const end = document.createElement("button");
      end.textContent = `End ${stream.title}`;
      end.hidden = broadcast?.stream?.id === stream.id;
      end.addEventListener("click", async () => {
        try {
          await api("stream/end", { authorized: true, body: { id: stream.id } });
          await Promise.all([refreshBroadcasts(), refreshStreams()]);
        } catch (error) {
          $("studioStatus").textContent = error.message;
        }
      });
      return end;
    }));
    $("broadcasts").replaceChildren(...streams.filter((stream) => stream.source === "obs").map((stream) => {
      const card = document.createElement("section");
      const title = document.createElement("h3");
      title.textContent = stream.title;
      const credentials = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Show OBS settings";
      const instructions = document.createElement("pre");
      instructions.className = "keybox";
      instructions.textContent = `Service: Custom\nServer: rtmp://${location.hostname}:1935\nStream key: ${stream.id}?key=${stream.streamKey}`;
      credentials.append(summary, instructions);
      const end = document.createElement("button");
      end.textContent = "End broadcast";
      end.addEventListener("click", async () => {
        end.disabled = true;
        try {
          await api("stream/end", { authorized: true, body: { id: stream.id } });
          $("operatorStatus").textContent = `Ended ${stream.title}.`;
          await Promise.all([refreshBroadcasts(), refreshStreams()]);
          $("startForm").elements.title.focus();
        } catch (error) {
          $("operatorStatus").textContent = error.message;
        } finally {
          end.disabled = false;
        }
      });
      card.append(title, credentials, end);
      return card;
    }));
  } catch (error) {
    $("studioStatus").textContent = error.message;
  }
}

$("startForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button");
  submit.disabled = true;
  try {
    await api("stream/start", { authorized: true, body: Object.fromEntries(new FormData(form)) });
    form.reset();
    $("operatorStatus").textContent = "Broadcast created. Open its OBS settings to connect your encoder.";
    await Promise.all([refreshBroadcasts(), refreshStreams()]);
  } catch (error) {
    $("operatorStatus").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

$("refreshStreams").addEventListener("click", refreshStreams);
refreshStreams();
setInterval(refreshStreams, 5000);

const studioForm = $("studioForm");
const preview = $("previewVideo");
const studioStatus = $("studioStatus");

function syncStudio() {
  $("previewBtn").disabled = pendingPreview || Boolean(broadcast);
  $("captureSource").disabled = pendingPreview || Boolean(broadcast);
  $("captureMic").disabled = pendingPreview || Boolean(broadcast) || $("captureSource").value === "microphone";
  $("goLiveBtn").disabled = !broadcast || broadcast.starting || Boolean(broadcast.stream);
  $("stopCaptureBtn").disabled = !broadcast;
}

async function stopBroadcast(message = "Sharing stopped.") {
  const current = broadcast;
  if (!current) return;
  broadcast = undefined;
  current.cancel.abort();
  current.peer?.close();
  current.media.getTracks().forEach((track) => track.stop());
  preview.srcObject = null;
  preview.hidden = true;
  studioStatus.textContent = message;
  syncStudio();
  try {
    const stream = current.stream ?? await current.creation?.catch(() => undefined);
    if (!stream) return;
    await api("stream/end", { authorized: true, body: { id: stream.id } });
  } catch (error) {
    studioStatus.textContent = error.message;
  }
  await Promise.all([refreshBroadcasts(), refreshStreams()]);
}

$("captureSource").addEventListener("change", syncStudio);
$("previewBtn").addEventListener("click", async () => {
  const source = $("captureSource").value;
  const microphone = $("captureMic").checked;
  const names = { camera: "your camera", screen: "the screen or window you choose", microphone: "your microphone" };
  const requested = names[source] + (source !== "microphone" && microphone ? " and your microphone" : "");
  $("permissionDetails").textContent = `PulsePlay will ask for access to ${requested} for a private preview. Viewers will see or hear it only after you select Go live.`;
  $("capturePermission").showModal();
});

$("allowCapture").addEventListener("click", async (event) => {
  event.preventDefault();
  $("capturePermission").close("allow");
  const owner = session;
  pendingPreview = true;
  syncStudio();
  try {
    const media = await capture($("captureSource").value, $("captureMic").checked);
    if (session !== owner) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    broadcast = { media, cancel: new AbortController() };
    for (const track of media.getTracks()) {
      track.addEventListener("ended", () => {
        if (broadcast?.media === media) void stopBroadcast("A shared device or screen stopped.");
      }, { once: true });
    }
    preview.srcObject = media;
    preview.hidden = !media.getVideoTracks().length;
    studioStatus.textContent = "Preview is local. Select Go live to start broadcasting.";
  } catch (error) {
    studioStatus.textContent = error.name === "NotAllowedError" ? "Sharing permission was declined or canceled." : error.message;
  } finally {
    pendingPreview = false;
    syncStudio();
  }
});

studioForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = broadcast;
  if (!current || current.starting || current.stream) return;
  current.starting = true;
  syncStudio();
  studioStatus.textContent = "Connecting to the media server…";
  try {
    current.creation = api("stream/start", {
      authorized: true, body: { title: studioForm.elements.title.value, source: "browser" }
    });
    current.stream = await current.creation;
    if (broadcast !== current) return;
    current.peer = new RTCPeerConnection({ iceServers: [] });
    const signal = AbortSignal.any([current.cancel.signal, AbortSignal.timeout(20000)]);
    await publish(current.peer, current.media, current.stream, signal);
    await connected(current.peer, signal);
    if (broadcast !== current) return;
    studioStatus.textContent = "You are live.";
    current.peer.addEventListener("connectionstatechange", () => {
      if (broadcast === current && current.peer.connectionState === "failed") void stopBroadcast("The stream connection was lost.");
    });
    await refreshStreams();
  } catch (error) {
    if (broadcast === current) await stopBroadcast(error.message);
  }
});

$("createKeyBtn").addEventListener("click", async () => {
  if (!session) return;
  const title = studioForm.elements.title.value.trim();
  if (!title) {
    studioStatus.textContent = "Enter a title first.";
    return;
  }
  $("createKeyBtn").disabled = true;
  try {
    const stream = await api("stream/start", { authorized: true, body: { title, source: "browser" } });
    $("streamKeyBox").hidden = false;
    $("streamKeyBox").textContent = `Stream id: ${stream.id}\nStream key: ${stream.streamKey}`;
    studioStatus.textContent = "Stream is active and listed. Video ingest is not part of this local setup, so playback stays on standby until a media server is added.";
    await Promise.all([refreshBroadcasts(), refreshStreams()]);
  } catch (error) {
    studioStatus.textContent = error.message;
  } finally {
    $("createKeyBtn").disabled = false;
  }
});

$("stopCaptureBtn").addEventListener("click", () => void stopBroadcast());
window.addEventListener("pagehide", () => {
  if (!broadcast) return;
  broadcast.peer?.close();
  broadcast.media.getTracks().forEach((track) => track.stop());
  if (broadcast.stream && session) {
    void fetch("/api/stream/end", {
      keepalive: true,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ id: broadcast.stream.id })
    }).catch(() => {});
  }
});
