import { connected, iceServers, mediaError, play, publish } from "./broadcast.js";

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
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("Server unreachable.");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 401 && authorized && retry && session?.refreshToken) {
    const previous = session;
    refreshRequest ??= api("auth/refresh", { body: { refreshToken: previous.refreshToken } })
      .then((tokens) => { if (session === previous) Object.assign(session, tokens); })
      .finally(() => { refreshRequest = undefined; });
    await refreshRequest;
    if (session !== previous) throw new Error("Sign in again to manage broadcasts.");
    return api(path, { body, authorized, retry: false });
  }
  if (!response.ok) {
    if (!data || response.status >= 502) throw new Error(data?.error || "Server unreachable.");
    throw new Error(data.error || "The request failed.");
  }
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

let whepPeer;
let watchGeneration = 0;

function clearPlayback() {
  watchGeneration += 1;
  clearTimeout(playbackTimeout);
  video.onerror = null;
  player?.destroy();
  player = undefined;
  whepPeer?.close();
  whepPeer = undefined;
  if (video.srcObject) video.srcObject = null;
  if (video.hasAttribute("src")) {
    video.removeAttribute("src");
    video.load();
  }
}

const clips = [
  {
    src: "/standby/hamsters.mp4",
    title: "Hamsters on a wheel",
    author: "Anna Frodesiak",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Dwarf_hamsters_running_on_disc.ogv"
  },
  {
    src: "/standby/kitten.mp4",
    title: "Kitten jumping on a mat",
    author: "Fumikas Sagisavas",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Kitten_jumping_on_bamboo_mat.webm"
  },
  {
    src: "/standby/otter.mp4",
    title: "Otter scrubbing up",
    author: "Uusijani",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Otter_scrubbing_up_at_Artis.ogv"
  },
  {
    src: "/standby/penguin.mp4",
    title: "Chinstrap penguin",
    author: "Aunuki",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Chinstrap_Penguin.ogv"
  },
  {
    src: "/standby/kitty.mp4",
    title: "Mr Kitty",
    author: "PseudoSkull",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:My_Cat_%22Mr_Kitty%22_or_%22Jellybelly%22.webm"
  },
  {
    src: "/standby/dogs.mp4",
    title: "Dogs in the grass",
    author: "Umngeni",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Africanis_Dogs_Resting_In_Grass.ogv"
  }
];
let standbyIndex = 0;
let standbyToken = 0;
let standbyFailures = 0;

function hideStandby() {
  $("standbyCredit").hidden = true;
  $("nextClip").hidden = true;
}

function showClip(clip) {
  const credit = $("standbyCredit");
  credit.hidden = false;
  $("nextClip").hidden = false;
  credit.replaceChildren(document.createTextNode(`${clip.title} · ${clip.author} · `));
  const license = document.createElement("a");
  license.href = clip.licenseUrl;
  license.rel = "noreferrer";
  license.target = "_blank";
  license.textContent = clip.license;
  const source = document.createElement("a");
  source.href = clip.sourceUrl;
  source.rel = "noreferrer";
  source.target = "_blank";
  source.textContent = "Wikimedia Commons";
  credit.append(license, document.createTextNode(" · "), source);
  $("playerStatus").textContent = `Standby ${standbyIndex + 1}/${clips.length}: ${clip.title}`;
}

function playStandby(index) {
  const token = ++standbyToken;
  clearPlayback();
  selectedStream = undefined;
  standby = true;
  standbyIndex = ((index % clips.length) + clips.length) % clips.length;
  const clip = clips[standbyIndex];
  video.loop = false;
  video.muted = true;
  showClip(clip);
  video.onerror = () => {
    if (token !== standbyToken) return;
    standbyFailures += 1;
    if (standbyFailures >= clips.length) {
      $("playerStatus").textContent = "The standby clips are unavailable.";
      return;
    }
    playStandby(standbyIndex + 1);
  };
  video.src = clip.src;
  void video.play().catch(() => {});
}

function watchStandby() {
  if (standby) return;
  standbyFailures = 0;
  playStandby(standbyIndex);
}

function watchHls(stream, generation) {
  const source = `/${stream.id}/index.m3u8`;
  const fail = () => {
    if (generation !== watchGeneration || selectedStream !== stream) return;
    unplayableUntil.set(stream.id, Date.now() + 15000);
    watchStandby();
  };
  video.onerror = fail;
  playbackTimeout = setTimeout(fail, 20000);
  if (window.Hls?.isSupported()) {
    player = new window.Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
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

async function watch(stream) {
  clearPlayback();
  const generation = watchGeneration;
  selectedStream = stream;
  standby = false;
  video.loop = false;
  video.muted = true;
  hideStandby();
  $("playerStatus").textContent = `Connecting to ${stream.title}…`;
  const signal = AbortSignal.timeout(12000);
  try {
    const peer = await play(stream.id, signal);
    if (generation !== watchGeneration) {
      peer.close();
      return;
    }
    whepPeer = peer;
    video.srcObject = peer.remoteStream;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebRTC did not show a picture.")), 8000);
      const done = () => {
        if (video.srcObject !== peer.remoteStream || video.videoWidth === 0) return;
        clearTimeout(timer);
        video.removeEventListener("playing", done);
        resolve();
      };
      video.addEventListener("playing", done);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      done();
    });
    if (generation !== watchGeneration) return;
    void video.play().catch(() => {});
  } catch {
    if (generation !== watchGeneration) return;
    whepPeer?.close();
    whepPeer = undefined;
    if (video.srcObject) video.srcObject = null;
    $("playerStatus").textContent = `WebRTC is not reachable. Playing ${stream.title} over HLS…`;
    watchHls(stream, generation);
  }
}

video.addEventListener("canplay", () => {
  clearTimeout(playbackTimeout);
  if (video.autoplay) void video.play().catch(() => {
    $("playerStatus").textContent = "Select Play to begin watching.";
  });
});

video.addEventListener("playing", () => {
  if (standby) {
    standbyFailures = 0;
    $("playerStatus").textContent = `Standby ${standbyIndex + 1}/${clips.length}: ${clips[standbyIndex].title}`;
  } else if (selectedStream) {
    const via = whepPeer ? "Low-latency WebRTC" : "HLS";
    $("playerStatus").textContent = `Live: ${selectedStream.title}. Unmute for sound. ${via}.`;
  }
});
video.addEventListener("ended", () => {
  if (!standby) return;
  standbyFailures = 0;
  playStandby(standbyIndex + 1);
});
$("nextClip").addEventListener("click", () => {
  if (!standby) return;
  standbyFailures = 0;
  playStandby(standbyIndex + 1);
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
setInterval(refreshStreams, 2000);

const studioForm = $("studioForm");
const preview = $("previewVideo");
const studioStatus = $("studioStatus");

function fillDeviceSelect(select, devices, selectedId, emptyLabel) {
  const previous = select.value;
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${emptyLabel} ${select.length + 1}`;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === (selectedId || previous))) {
    select.value = selectedId || previous;
  }
}

function deviceConstraints() {
  const video = $("cameraSelect").value ? { deviceId: { exact: $("cameraSelect").value } } : true;
  const audio = $("micSelect").value ? { deviceId: { exact: $("micSelect").value } } : true;
  return { video, audio };
}

function syncStudio() {
  const live = Boolean(broadcast?.stream);
  $("previewBtn").disabled = pendingPreview || live;
  $("cameraSelect").disabled = pendingPreview || live || !broadcast;
  $("micSelect").disabled = pendingPreview || live || !broadcast;
  $("goLiveBtn").disabled = !broadcast || broadcast.starting || live;
  $("stopCaptureBtn").disabled = !broadcast;
  $("stopCaptureBtn").textContent = live ? "Stop streaming" : "Stop preview";
  $("muteBtn").hidden = !broadcast?.media.getAudioTracks().length;
  $("cameraOffBtn").hidden = !broadcast?.media.getVideoTracks().length;
}

async function stopBroadcast(message = "Streaming stopped.") {
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

async function openPreview() {
  const owner = session;
  pendingPreview = true;
  syncStudio();
  const previous = broadcast;
  try {
    const media = await navigator.mediaDevices.getUserMedia(previous ? deviceConstraints() : { video: true, audio: true });
    if (session !== owner) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    previous?.cancel.abort();
    previous?.media.getTracks().forEach((track) => track.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const settings = {
      video: media.getVideoTracks()[0]?.getSettings().deviceId,
      audio: media.getAudioTracks()[0]?.getSettings().deviceId
    };
    fillDeviceSelect($("cameraSelect"), devices.filter((device) => device.kind === "videoinput"), settings.video, "Camera");
    fillDeviceSelect($("micSelect"), devices.filter((device) => device.kind === "audioinput"), settings.audio, "Microphone");
    broadcast = { media, cancel: new AbortController() };
    for (const track of media.getTracks()) {
      track.addEventListener("ended", () => {
        if (broadcast?.media === media) void stopBroadcast("The camera or microphone stopped.");
      }, { once: true });
    }
    preview.srcObject = media;
    preview.hidden = false;
    $("muteBtn").textContent = "Mute";
    $("cameraOffBtn").textContent = "Camera off";
    studioStatus.textContent = "Preview is only on this computer. Start streaming when you are ready.";
  } catch (error) {
    studioStatus.textContent = mediaError(error);
  } finally {
    pendingPreview = false;
    syncStudio();
  }
}

$("previewBtn").addEventListener("click", () => void openPreview());
for (const select of [$("cameraSelect"), $("micSelect")]) {
  select.addEventListener("change", () => {
    if (broadcast && !broadcast.stream && !pendingPreview) void openPreview();
  });
}
$("muteBtn").addEventListener("click", () => {
  const track = broadcast?.media.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("muteBtn").textContent = track.enabled ? "Mute" : "Unmute";
});
$("cameraOffBtn").addEventListener("click", () => {
  const track = broadcast?.media.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("cameraOffBtn").textContent = track.enabled ? "Camera off" : "Camera on";
});

studioForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = broadcast;
  if (!current || current.starting || current.stream) return;
  const title = studioForm.elements.title.value.trim();
  if (!title) {
    studioStatus.textContent = "Enter a title first.";
    return;
  }
  current.starting = true;
  syncStudio();
  studioStatus.textContent = "Connecting to the media server…";
  try {
    current.creation = api("stream/start", { authorized: true, body: { title, source: "browser" } });
    current.stream = await current.creation;
    if (broadcast !== current) return;
    current.peer = new RTCPeerConnection({ iceServers });
    const signal = AbortSignal.any([current.cancel.signal, AbortSignal.timeout(20000)]);
    await publish(current.peer, current.media, current.stream, signal);
    await connected(current.peer, signal);
    if (broadcast !== current) return;
    studioStatus.textContent = "You are live. Viewers switch from the standby clips to this camera.";
    current.peer.addEventListener("connectionstatechange", () => {
      if (broadcast === current && current.peer.connectionState === "failed") void stopBroadcast("The stream connection was lost.");
    });
    await Promise.all([refreshBroadcasts(), refreshStreams()]);
  } catch (error) {
    if (broadcast === current) await stopBroadcast(error.message || "Could not start the stream.");
  } finally {
    if (broadcast === current) {
      current.starting = false;
      syncStudio();
    }
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
