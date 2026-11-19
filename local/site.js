import express from "express";
import { homedir } from "node:os";
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

app.get("/health", (_req, res) => res.json({ ok: true, service: "frontend" }));

app.use((req, res, next) => {
  if (allowedHosts.includes("*") || allowedHosts.includes(req.hostname)) return next();
  return res.sendStatus(403);
});
app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      connectSrc: ["'self'", "ws://127.0.0.1:4001", "ws://localhost:4001"],
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
    const upstreamRequest = request({
      hostname: target.host, port: target.port, method: req.method, path: req.originalUrl, headers
    }, (response) => {
      res.status(response.statusCode);
      for (const [name, value] of Object.entries(response.headers)) {
        if (["content-type", "cache-control", "content-length", "location", "set-cookie", "etag", "link", "accept-patch"].includes(name)) res.set(name, value);
      }
      response.pipe(res);
    });
    upstreamRequest.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.status(502).json({ error: "The local service is unavailable." });
    });
    res.on("close", () => upstreamRequest.destroy());
    req.pipe(upstreamRequest);
  };
}

app.use(/^\/api\/auth\/(register|login|refresh|profile)$/, proxy(auth));
app.use(/^\/api\/content(?:\/.*)?$/, proxy(content));
app.use(/^\/api\/(streams|stream\/(start|end|manage))$/, proxy(streams));
app.use(/^\/[a-f0-9-]{36}\/whip(?:\/[a-f0-9-]{36})?$/, proxy({ host: process.env.MEDIA_WHIP_HOST || "127.0.0.1", port: Number(process.env.MEDIA_WHIP_PORT || 8890) }));
app.use(/^\/[a-f0-9-]{36}\/(index\.m3u8|[A-Za-z0-9_.-]+\.(m3u8|mp4|ts))$/, proxy({ host: process.env.MEDIA_HLS_HOST || "127.0.0.1", port: Number(process.env.MEDIA_HLS_PORT || 8888) }));

app.get("/standby/big-buck-bunny.mp4", (_req, res) => {
  res.sendFile(join(homedir(), ".pulseplay-local", "big-buck-bunny.mp4"), { maxAge: "1h" }, (error) => {
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
  app.get(url, (_req, res) => res.sendFile(fileURLToPath(new URL(`../${file}`, import.meta.url))));
}

const printableHost = bind === "0.0.0.0" || bind === "::" ? "127.0.0.1" : bind;
app.listen(port, bind, () => console.log(`PulsePlay is running at http://${printableHost}:${port}/`));
