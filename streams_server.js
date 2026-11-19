import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import routes from "./streams_routes.js";
import { initSchema } from "./streams_db.js";
import { log } from "./Common Utilities.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true, service: "streams" }));
app.use("/api", routes);
app.use((error, _req, res, _next) => {
  log("[streams] request failed", error.code || error.name);
  res.status(500).json({ error: "The stream service could not complete the request." });
});

const port = Number(process.env.STREAMS_PORT || 4002);
await initSchema();
app.listen(port, process.env.LOCAL_BIND || undefined, () => log(`[streams] http://localhost:${port}`));
