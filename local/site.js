import express from "express";
import { homedir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import helmet from "helmet";

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!["127.0.0.1", "localhost"].includes(req.hostname)) return res.sendStatus(403);
  next();
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

function proxy(port) {
  return (req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.connection;
    const upstream = request({
      hostname: "127.0.0.1", port, method: req.method, path: req.originalUrl, headers
    }, (response) => {
      res.status(response.statusCode);
      for (const [name, value] of Object.entries(response.headers)) {
        if (["content-type", "cache-control", "content-length", "location", "set-cookie", "etag", "link", "accept-patch"].includes(name)) res.set(name, value);
      }
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.status(502).json({ error: "The local service is unavailable." });
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };
}

app.use(/^\/api\/auth\/(register|login|refresh|profile)$/, proxy(4000));
app.use(/^\/api\/(streams|stream\/(start|end|manage))$/, proxy(4002));
app.use(/^\/[a-f0-9-]{36}\/whip(?:\/[a-f0-9-]{36})?$/, proxy(8890));
app.use(/^\/[a-f0-9-]{36}\/(index\.m3u8|[A-Za-z0-9_.-]+\.(m3u8|mp4|ts))$/, proxy(8888));

app.get("/standby/big-buck-bunny.mp4", (_req, res, next) => {
  res.sendFile(join(homedir(), ".pulseplay-local", "big-buck-bunny.mp4"), { maxAge: "1h" }, (error) => {
    if (error) next(error);
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

app.listen(4173, "127.0.0.1", () => console.log("PulsePlay is running at http://127.0.0.1:4173/"));
