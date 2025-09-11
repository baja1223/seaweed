H.264 → HLS (CMAF fMP4) Encoding Ladder

Goals
- Consistent 2s GOP aligned across renditions for smooth ABR and LL prep.
- CMAF fMP4 segments (`.m4s`) with init segments for future LL-HLS.
- Reasonable bitrates that work on typical consumer networks.

Key Rules
- GOP: 2 seconds (scenecut off). 30fps → g=60; 60fps → g=120.
- Keyframe alignment across all renditions.
- `sc_threshold=0` (FFmpeg) and `scenecut=0` (x264) to avoid drifting keyframes.
- Audio: AAC 48 kHz, 2ch, 128–160 kbps.
- Segments: 2s segment duration; playlists are short (4–6 segments live).

Recommended Ladder (30fps)
- 1080p30: 5800 Kbps video, 160 Kbps audio (≈ 6 Mbps total)
- 720p30: 3000 Kbps video, 128 Kbps audio (≈ 3.1 Mbps total)
- 540p30: 1800 Kbps video, 128 Kbps audio (≈ 1.9 Mbps total)
- 360p30: 800 Kbps video, 96 Kbps audio (≈ 0.9 Mbps total)
- 240p30: 400 Kbps video, 64 Kbps audio (≈ 0.46 Mbps total)

Recommended Ladder (60fps)
- 1080p60: 7800 Kbps video, 160 Kbps audio (≈ 8 Mbps total)
- 720p60: 4500 Kbps video, 128 Kbps audio (≈ 4.6 Mbps total)
- 540p60: 2600 Kbps video, 128 Kbps audio (≈ 2.7 Mbps total)
- 360p60: 1200 Kbps video, 96 Kbps audio (≈ 1.3 Mbps total)

FFmpeg Example (CMAF HLS, 30fps ladder)
Note: adjust `-g` / `-keyint_min` to 120 for 60fps inputs.

```
ffmpeg -i input.mp4 \
  -map v:0 -map a:0 -map v:0 -map a:0 -map v:0 -map a:0 -map v:0 -map a:0 -map v:0 -map a:0 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -sc_threshold 0 \
  -x264-params "scenecut=0:open_gop=0:keyint=60:min-keyint=60" \
  -c:a aac -ar 48000 -ac 2 \
  -filter:v:0 scale=-2:1080 -b:v:0 5800k -maxrate:v:0 6500k -bufsize:v:0 11600k \
  -filter:v:1 scale=-2:720  -b:v:1 3000k -maxrate:v:1 3300k -bufsize:v:1 6000k \
  -filter:v:2 scale=-2:540  -b:v:2 1800k -maxrate:v:2 2000k -bufsize:v:2 3600k \
  -filter:v:3 scale=-2:360  -b:v:3 800k  -maxrate:v:3 900k  -bufsize:v:3 1600k \
  -filter:v:4 scale=-2:240  -b:v:4 400k  -maxrate:v:4 450k  -bufsize:v:4 800k \
  -b:a:0 160k -b:a:1 128k -b:a:2 128k -b:a:3 96k -b:a:4 64k \
  -f hls -hls_time 2 -hls_playlist_type event \
  -hls_segment_type fmp4 -hls_flags independent_segments+program_date_time+append_list \
  -master_pl_name master.m3u8 \
  -hls_fmp4_init_filename v%v/init.mp4 \
  -hls_segment_filename v%v/seg_%06d.m4s \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4" \
  out_%v.m3u8
```

Notes
- `scale=-2:HEIGHT` preserves aspect ratio and ensures width divisible by 2.
- `maxrate` ≈ 1.1× to 1.2× of target; `bufsize` ≈ 2× of `maxrate` (tunable).
- For NVENC, replace video codec flags with:
  - `-c:v h264_nvenc -preset p5 -tune hq -bf 2 -rc cbr_hq -g 60 -sc_threshold 0`
  - Adjust `-b:v`, `-maxrate:v`, `-bufsize:v` per rendition as above.

Preparing for LL-HLS
- Using CMAF fMP4 segments and 2s GOPs sets you up for LL-HLS.
- For LL-HLS, you’ll add partial segments (EXT-X-PART) with ~200–500ms part duration and keep segment duration at 1–2s. This requires packager support and CDN/header adjustments.
- Keep playlists short (3–6 segments) and make sure CDN respects low TTLs for playlists while caching segments long with `immutable`.

Serving Tips
- `.m3u8` → `application/vnd.apple.mpegurl`; `.m4s` → `video/iso.segment`.
- Playlists: `Cache-Control: public, max-age=1, must-revalidate`.
- Segments: `Cache-Control: public, max-age=86400, immutable`.
- CORS: allow your frontend origins; add `Vary: Origin` and `Timing-Allow-Origin`.

