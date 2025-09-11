OBS & Encoder Guidance (Creators)

Goals
- Good quality at reasonable bitrates.
- Stable keyframes to match segmenting (HLS/LL-HLS).
- Optional low-latency tradeoffs.

RTMP/WHIP Ingest
- Use your stream key from POST /api/stream/start.
- RTMP example: rtmp://ingest.example.com/live
- Stream Key: output of the start API (keep secret).

Video Codec
- H.264 (x264 / NVENC / AMF / QSV): Most compatible for HLS.
- HEVC/H.265 or AV1: Better quality at lower bitrate, but ensure your packager + player pipeline supports these.

Keyframe / GOP
- Keyframe Interval: 2 seconds (e.g., 60fps → 120; 30fps → 60).
- Set “Keyframes: Fixed” or “Force Keyframe Interval” if available.
- B-frames: 2 recommended for quality. For extreme low-latency, you may reduce to 0–1 at some quality cost.

Rate Control
- Preferred: CBR for predictable HLS packaging and easier ABR.
- If using quality-based RC (CQP/CRF/VBR), set a reasonable max bitrate to avoid CDN egress spikes.

Recommended Ladders (H.264)
- 1080p60: 6000–8000 Kbps, High profile, B-frames=2.
- 1080p30: 4500–6000 Kbps, High profile, B-frames=2.
- 720p60: 3500–4500 Kbps, High profile, B-frames=2.
- 720p30: 2500–3500 Kbps, High profile, B-frames=2.
- 480p30: 1200–1800 Kbps, Main/High, B-frames=2.
- Audio: AAC 128–160 Kbps, 48 kHz, stereo.

NVENC (GeForce) Settings
- Rate Control: CBR
- Bitrate: per ladder above
- Keyframe Interval: 2 s
- Preset: P5 (Quality) or P6 (Max Quality) if headroom; P4 (Performance) for low-latency
- Profile: High
- Look-ahead: Off for lowest latency; On improves quality at cost of delay
- Psycho-visual Tuning: On (quality); Off for lowest latency

x264 (CPU) Settings
- Rate Control: CBR
- Bitrate: per ladder
- Keyframe Interval: 2 s
- CPU Preset: veryfast (streaming baseline). Faster presets reduce CPU; slower improves quality if CPU allows
- Tune: empty (default). For ultra-low latency, you can try tune=zerolatency, but expect some quality loss

Low-Latency Tips (LL-HLS)
- Keep FPS modest (30 or 60 max) and maintain exact 2s GOP.
- Avoid sudden large bitrate spikes.
- Audio: keep constant bitrate (AAC 128–160 Kbps).
- Test network stability; LL adds sensitivity to jitter.

Troubleshooting
- Stutters: lower bitrate or resolution; check CPU/GPU encoding load.
- Frequent rebuffering: verify upload bandwidth headroom (>120% of chosen bitrate) and stable RTT.
- Desync: ensure keyframe interval matches packager segmenting (usually 2s segments).

