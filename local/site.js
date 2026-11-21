import express from "express";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import helmet from "helmet";

const app = express();
app.disable("x-powered-by");

const port = Number(process.env.FRONTEND_PORT || 4173);
const bind = process.env.WEB_BIND || "127.0.0.1";
const allowedHosts = (process.env.WEB_HOSTS || "127.0.0.1,localhost,::1")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

function upstream(hostEnv, portEnv, fallbackPort) {
  return {
    host: process.env[hostEnv] || "127.0.0.1",
    port: Number(process.env[portEnv] || fallbackPort)
  };
}

const auth = upstream("AUTH_HOST", "AUTH_PORT", 4000);
const streams = upstream("STREAMS_HOST", "STREAMS_PORT", 4002);
const content = upstream("CONTENT_HOST", "CONTENT_PORT", 4003);
const chat = upstream("CHAT_HOST", "CHAT_PORT", 4001);

function hostAllowed(hostname) {
  return allowedHosts.includes("*") || allowedHosts.includes(hostname);
}

function hostnameFromHeader(value) {
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(1, end);
  }
  return value.split(":")[0];
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "frontend" }));

app.use((req, res, next) => {
  if (hostAllowed(req.hostname)) return next();
  return res.status(403).json({
    error: "This address is not allowed. Open the app on port 4173, or run bash scripts/doctor.sh.",
    reason: "host_not_allowed"
  });
});
app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: null
    }
  },
  strictTransportSecurity: false
}));

function proxy(target) {
  return (req, res) => {
    const headers = { ...req.headers, host: `${target.host}:${target.port}` };
    delete headers.connection;
    const path = target.strip ? req.originalUrl.slice(target.strip.length) || "/" : req.originalUrl;
    const upstreamRequest = request({
      hostname: target.host, port: target.port, method: req.method, path, headers
    }, (response) => {
      res.status(response.statusCode);
      for (const [name, value] of Object.entries(response.headers)) {
        if (["content-type", "cache-control", "content-length", "location", "set-cookie", "etag", "link", "accept-patch"].includes(name)) res.set(name, value);
      }
      response.pipe(res);
    });
    upstreamRequest.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.status(502).json({ error: "Server unreachable.", reason: "upstream_down" });
    });
    res.on("close", () => upstreamRequest.destroy());
    req.pipe(upstreamRequest);
  };
}

app.use(/^\/api\/auth\/(register|login|refresh|profile)$/, proxy(auth));
app.use(/^\/api\/content(?:\/.*)?$/, proxy(content));
app.use(/^\/api\/(streams|stream\/(start|end|manage|record)|recordings(?:\/[0-9a-f-]+)?|clips(?:\/[0-9a-f-]+)?)$/, proxy(streams));
const mediaWebRtc = { host: process.env.MEDIA_WHIP_HOST || "127.0.0.1", port: Number(process.env.MEDIA_WHIP_PORT || 8889) };
const mediaHls = { host: process.env.MEDIA_HLS_HOST || "127.0.0.1", port: Number(process.env.MEDIA_HLS_PORT || 8888) };
const mediaPlayback = { host: process.env.MEDIA_PLAYBACK_HOST || "127.0.0.1", port: Number(process.env.MEDIA_PLAYBACK_PORT || 9996) };
app.use(/^\/[a-f0-9-]{36}\/(whip|whep)(?:\/[A-Fa-f0-9-]+)?$/, proxy(mediaWebRtc));
app.use(/^\/[a-f0-9-]{36}\/(index\.m3u8|[A-Za-z0-9_.-]+\.(m3u8|mp4|ts|m4s))$/, proxy(mediaHls));
app.use("/playback", proxy({ ...mediaPlayback, strip: "/playback" }));

const standbyDir = fileURLToPath(new URL("../media/standby/", import.meta.url));
const clipsDir = process.env.CLIPS_DIR || fileURLToPath(new URL("../media/clips/", import.meta.url));
const page = fileURLToPath(new URL("../index.html", import.meta.url));
app.get("/clip/:id", (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
  res.set("Cache-Control", "no-cache");
  res.sendFile(page);
});
app.get("/clips/:name", (req, res) => {
  if (!/^[0-9a-f-]{36}\.mp4$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(join(clipsDir, req.params.name), (error) => {
    if (error && !res.headersSent) res.sendStatus(error.statusCode || 404);
  });
});
app.get("/standby/:name", (req, res) => {
  if (!/^[a-z0-9-]+\.mp4$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(join(standbyDir, req.params.name), (error) => {
    if (error && !res.headersSent) res.sendStatus(error.statusCode || 404);
  });
});

const assets = {
  "/": "index.html",
  "/index.js": "index.js",
  "/styles.css": "styles.css",
  "/broadcast.js": "broadcast.js",
  "/hls.js": "node_modules/hls.js/dist/hls.min.js"
};
for (const [url, file] of Object.entries(assets)) {
  app.get(url, (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(fileURLToPath(new URL(`../${file}`, import.meta.url)));
  });
}

function proxyChat(request, socket, head) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/ws") {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }
  if (!hostAllowed(hostnameFromHeader(request.headers.host))) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }

  socket.pause();
  const upstream = createConnection({ host: chat.host, port: chat.port });
  const fail = () => {
    socket.destroy();
    upstream.destroy();
  };
  socket.on("error", fail);
  upstream.on("error", fail);
  upstream.on("connect", () => {
    const lines = [
      `GET /${url.search} HTTP/1.1`,
      `Host: ${chat.host}:${chat.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${request.headers["sec-websocket-key"]}`,
      `Sec-WebSocket-Version: ${request.headers["sec-websocket-version"] || "13"}`
    ];
    if (request.headers["sec-websocket-protocol"]) {
      lines.push(`Sec-WebSocket-Protocol: ${request.headers["sec-websocket-protocol"]}`);
    }
    if (request.headers.origin) lines.push(`Origin: ${request.headers.origin}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
    socket.resume();
  });
}

const printableHost = bind === "0.0.0.0" || bind === "::" ? "127.0.0.1" : bind;
const server = createServer(app);
server.on("upgrade", proxyChat);
server.listen(port, bind, () => console.log(`PulsePlay is running at http://${printableHost}:${port}/`));
