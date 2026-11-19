export async function capture(source, microphone) {
  const devices = navigator.mediaDevices;
  if (!devices) throw new Error("Use HTTPS or localhost to share media.");
  if (source !== "screen") {
    return devices.getUserMedia({ video: source === "camera", audio: source === "microphone" || microphone });
  }

  const screen = await devices.getDisplayMedia({ video: true, audio: false });
  if (!microphone) return screen;
  try {
    const mic = await devices.getUserMedia({ audio: true });
    mic.getTracks().forEach((track) => screen.addTrack(track));
    return screen;
  } catch (error) {
    screen.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export async function publish(peer, media, stream, signal) {
  for (const track of media.getTracks()) {
    const transceiver = peer.addTransceiver(track, { streams: [media], direction: "sendonly" });
    const codecs = RTCRtpSender.getCapabilities(track.kind)?.codecs || [];
    const mimeType = track.kind === "video" ? "video/h264" : "audio/opus";
    const compatible = codecs.filter((codec) => codec.mimeType.toLowerCase() === mimeType);
    if (compatible.length && transceiver.setCodecPreferences) transceiver.setCodecPreferences(compatible);
  }

  await peer.setLocalDescription(await peer.createOffer());
  if (peer.iceGatheringState !== "complete") {
    await new Promise((resolve, reject) => {
      const complete = () => {
        if (peer.iceGatheringState === "complete") {
          peer.removeEventListener("icegatheringstatechange", complete);
          resolve();
        }
      };
      peer.addEventListener("icegatheringstatechange", complete);
      signal.addEventListener("abort", () => {
        peer.removeEventListener("icegatheringstatechange", complete);
        reject(signal.reason);
      }, { once: true });
      if (signal.aborted) reject(signal.reason);
      complete();
    });
  }

  const response = await fetch(`/${stream.id}/whip`, {
    method: "POST",
    headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${stream.streamKey}` },
    body: peer.localDescription.sdp,
    signal
  });
  if (response.status !== 201) throw new Error("The media server declined the browser broadcast.");
  const answer = await response.text();
  await peer.setRemoteDescription({ type: "answer", sdp: answer });
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
