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

