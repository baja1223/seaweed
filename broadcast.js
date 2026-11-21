const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

export function mediaError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "Camera or microphone permission was denied. On a Mac, open System Settings > Privacy & Security > Camera and Microphone, allow Safari or Chrome, then try again.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError" || error?.name === "OverconstrainedError") {
    return "No camera or microphone was found. Plug one in, or check System Settings > Privacy & Security > Camera and Microphone.";
  }
  if (error?.name === "NotReadableError") {
    return "The camera or microphone is already in use by another app.";
  }
  return error?.message || "Could not open the camera or microphone.";
}

function waitForIce(peer, signal) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const complete = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", complete);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", complete);
    signal.addEventListener("abort", () => {
      peer.removeEventListener("icegatheringstatechange", complete);
      reject(signal.reason || new Error("The media connection was cancelled."));
    }, { once: true });
    if (signal.aborted) reject(signal.reason || new Error("The media connection was cancelled."));
  });
}

async function exchange(peer, url, token, signal) {
  await peer.setLocalDescription(await peer.createOffer());
  await waitForIce(peer, signal);
  const headers = { "Content-Type": "application/sdp" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: "POST", headers, body: peer.localDescription.sdp, signal });
  if (response.status !== 201) throw new Error("The media server declined the connection.");
  await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
}

export async function publish(peer, media, stream, signal) {
  for (const track of media.getTracks()) {
    const transceiver = peer.addTransceiver(track, { streams: [media], direction: "sendonly" });
    const codecs = RTCRtpSender.getCapabilities(track.kind)?.codecs || [];
    const mimeType = track.kind === "video" ? "video/h264" : "audio/opus";
    const compatible = codecs.filter((codec) => codec.mimeType.toLowerCase() === mimeType);
    if (compatible.length && transceiver.setCodecPreferences) transceiver.setCodecPreferences(compatible);
  }
  await exchange(peer, `/${stream.id}/whip`, stream.streamKey, signal);
}

export async function play(streamId, signal) {
  const peer = new RTCPeerConnection({ iceServers });
  try {
    const remote = new MediaStream();
    peer.remoteStream = remote;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.addEventListener("track", (event) => {
      if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
    });
    await exchange(peer, `/${streamId}/whep`, "", signal);
    await connected(peer, signal);
    return peer;
  } catch (error) {
    peer.close();
    throw error;
  }
}

export function connected(peer, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      peer.removeEventListener("connectionstatechange", update);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("The browser could not connect to the media server."));
    };
    const update = () => {
      if (peer.connectionState === "connected") {
        cleanup();
        resolve();
      } else if (["closed", "failed"].includes(peer.connectionState)) {
        abort();
      }
    };
    peer.addEventListener("connectionstatechange", update);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else update();
  });
}

export { iceServers };
