Streaming CDN and HTTP/2/3 Guidance

Key Headers
- Cache-Control (playlists): public, max-age=1, must-revalidate
- Cache-Control (segments): public, max-age=86400, immutable
- Content-Type: .m3u8 = application/vnd.apple.mpegurl; .ts = video/mp2t; .m4s = video/iso.segment; .mp4 = video/mp4
- CORS: Access-Control-Allow-Origin: <your origins>; Access-Control-Allow-Credentials: true (if needed)
- Timing-Allow-Origin: <your origins> (enables Resource Timing)
- Accept-Ranges: bytes (seek support)
- Vary: Origin (when using dynamic CORS)

Nginx (HTTP/2 + HTTP/3 + HLS caching)
server {
    listen 443 ssl http2;
#   Requires Nginx with QUIC/HTTP3 support
#    listen 443 quic reuseport;

    server_name streams.example.com;
    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    # Advertise HTTP/3
    add_header Alt-Svc 'h3=\":443\"; ma=86400';

    # Gzip/Brotli playlists only (not segments)
    gzip on;
    gzip_types application/vnd.apple.mpegurl;

#   brotli on;               # if built with brotli
#   brotli_types application/vnd.apple.mpegurl;

    # CORS (adjust origins)
    set $allowed_origin "https://your-frontend.example.com";
    if ($http_origin ~* (your-frontend\.example\.com|localhost:3000)) { set $allowed_origin $http_origin; }

    location /hls/ {
        # Playlist headers
        location ~* \.m3u8$ {
            types { application/vnd.apple.mpegurl m3u8; }
            default_type application/vnd.apple.mpegurl;
            add_header Cache-Control "public, max-age=1, must-revalidate" always;
            add_header Access-Control-Allow-Origin "$allowed_origin" always;
            add_header Timing-Allow-Origin "$allowed_origin" always;
            add_header Vary "Origin" always;
            try_files $uri =404;
        }

        # Segment/part headers
        location ~* \.(ts|m4s|mp4)$ {
            types { video/mp2t ts; video/iso.segment m4s; video/mp4 mp4; }
            add_header Cache-Control "public, max-age=86400, immutable" always;
            add_header Access-Control-Allow-Origin "$allowed_origin" always;
            add_header Timing-Allow-Origin "$allowed_origin" always;
            add_header Accept-Ranges "bytes" always;
            add_header Vary "Origin" always;
            try_files $uri =404;
        }
    }
}

Cloudflare (CDN)
- Enable HTTP/3 with QUIC in Network settings.
- Caching:
  - Rule 1: Path *.m3u8 → Cache Level: Bypass or small Edge TTL (e.g., 2s), Origin Cache Control: Respect.
  - Rule 2: Path *.(ts|m4s|mp4) → Cache Everything, Edge TTL: a day, Respect origin headers, Ignore query strings (unless your packager encodes variants in query).
- CORS: Use Transform Rules or Origin headers. Ensure Vary: Origin.
- Brotli: On (playlists only); do not compress segments.

Express origin example (static HLS)
app.use("/hls", express.static(path.join(__dirname, "public/hls"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".m3u8")) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "public, max-age=1, must-revalidate");
      res.setHeader("Vary", "Origin");
    } else if (/\.(ts|m4s|mp4)$/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Accept-Ranges", "bytes");
      if (filePath.endsWith(".ts")) res.setHeader("Content-Type", "video/mp2t");
      if (filePath.endsWith(".m4s")) res.setHeader("Content-Type", "video/iso.segment");
      if (filePath.endsWith(".mp4")) res.setHeader("Content-Type", "video/mp4");
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    const origin = res.req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Timing-Allow-Origin", origin);
  }
}));

Notes
- Keep playlists very short for live (3–6 target durations). For LL-HLS use partial segments; don’t cache parts.
- Segment names should be unique (sequence-numbered) so they can be cached immutable.
- Prefer HTTP/2 or HTTP/3 between client and CDN. Origin to CDN can be HTTP/1.1 but ensure keep-alive and compression for playlists.

LL‑HLS (Partial Segments, 2–5s Target)
- Playlists: must be uncached or near‑uncached at the edge (Edge TTL 0–2s) and respect origin Cache‑Control. CDN must not serve stale playlists.
- Parts: avoid caching partial segments (EXT‑X‑PART URIs). If your naming convention distinguishes parts (e.g., seg_12345_part0.m4s), set a rule to bypass caching for them.
- Server‑Control: ensure the manifest carries EXT‑X‑SERVER‑CONTROL with CAN‑BLOCK‑RELOAD=YES, HOLD‑BACK≈3s, PART‑HOLD‑BACK≈1s. Your packager (FFmpeg) emits these when configured for LL‑HLS.
- Preload‑Hint: allow '#EXT‑X‑PRELOAD‑HINT' to pass through untouched; some CDNs strip unknown headers/tags—don’t rewrite playlists.
- Blocking origin fetch: enable origin read timeouts high enough (e.g., 15–30s) and allow request coalescing so the CDN can block on the origin playlist update rather than serving stale.
- Range: keep 'Accept‑Ranges: bytes' and 'Vary: Origin' in place.

Cloudflare specifics
- Caching rules:
  - Path: *.m3u8 → Bypass cache or Edge TTL ≤2s, Origin Cache Control: Respect.
  - Path: *part*.m4s → Bypass cache.
  - Path: *.(m4s|ts|mp4) (non‑part) → Cache Everything, respect origin headers, Edge TTL up to 1 day.
- Network:
  - Enable HTTP/3 with QUIC.
  - Increase Origin Response Timeout to tolerate blocked playlist requests.
  - Disable features that might buffer/transform responses (Rocket Loader, HTML minify) on the stream hostname.

NGINX origin tweaks for LL‑HLS
- Ensure playlist locations allow long‑polling (send_timeout ≥ 30s) and don’t buffer:
  - 'proxy_buffering off;' (if proxying a packager)
  - 'tcp_nodelay on;'
- Keep playlist cache minimal and parts uncached as shown above.

Nginx Origin Example (LL‑HLS with server‑control and part bypass)
# Assumes files under /var/www/hls or proxy to a packager. Adjust hostnames.
map $http_origin $allowed_origin {
    default "";
    ~^https?://(localhost:3000|your-frontend\.example\.com)$ $http_origin;
}

server {
    listen 443 ssl http2;
#   listen 443 quic reuseport;   # if Nginx built with QUIC/HTTP3
    server_name streams.example.com;

    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;
    add_header Alt-Svc 'h3=\":443\"; ma=86400' always;

    gzip on;                          # playlists only
    gzip_types application/vnd.apple.mpegurl;
#   brotli on; brotli_types application/vnd.apple.mpegurl;  # if available

    root /var/www;                    # or proxy_pass to packager below

    # Playlists (.m3u8) — no-cache + allow blocking reload
    location ~* \.m3u8$ {
        types { application/vnd.apple.mpegurl m3u8; }
        default_type application/vnd.apple.mpegurl;
        add_header Access-Control-Allow-Origin "$allowed_origin" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Timing-Allow-Origin "$allowed_origin" always;
        add_header Vary "Origin" always;

        # For LL-HLS, avoid serving stale playlists
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;

        # If proxying to a live packager, enable blocking reload behavior
#       proxy_pass http://127.0.0.1:8080;   # packager endpoint
#       proxy_request_buffering off;
#       proxy_buffering off;
#       proxy_read_timeout 30s;

        try_files $uri =404;  # static mode
    }

    # LL-HLS partial segments: match *_partNN.m4s and bypass cache
    location ~* _part\d+\.m4s$ {
        types { video/iso.segment m4s; }
        default_type video/iso.segment;
        add_header Access-Control-Allow-Origin "$allowed_origin" always;
        add_header Timing-Allow-Origin "$allowed_origin" always;
        add_header Vary "Origin" always;
        add_header Cache-Control "no-store" always;   # do not cache parts
        add_header X-Accel-Expires 0 always;
        try_files $uri =404;
    }

    # Full segments (m4s/ts/mp4) — cache immutable
    location ~* \.(m4s|ts|mp4)$ {
        types { video/iso.segment m4s; video/mp2t ts; video/mp4 mp4; }
        add_header Cache-Control "public, max-age=86400, immutable" always;
        add_header Accept-Ranges "bytes" always;
        add_header Access-Control-Allow-Origin "$allowed_origin" always;
        add_header Timing-Allow-Origin "$allowed_origin" always;
        add_header Vary "Origin" always;
        try_files $uri =404;
    }
}

Notes
- EXT-X-SERVER-CONTROL (CAN-BLOCK-RELOAD, HOLD-BACK, PART-HOLD-BACK) is emitted by the packager in the playlist, not by Nginx headers; ensure your packager is configured for LL-HLS.
- The part match uses the common *_partNN.m4s convention; adapt to your packager’s naming.

