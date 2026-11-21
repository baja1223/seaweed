import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { connectMongo } from "./content_db.js";
import routes from "./content_routes.js";
import { corsOrigin, err, log, requireEnv } from "./Common Utilities.js";

const mongoUri = process.env.CONTENT_MONGO_URI || process.env.MONGO_URI;
if (!mongoUri) {
  requireEnv(["CONTENT_MONGO_URI"]);
}

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigin(), credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true, service: "content" }));
app.use("/api/content", routes);

const port = Number(process.env.CONTENT_PORT || 4003);
connectMongo(mongoUri).then(() => {
  const server = app.listen(port, process.env.LOCAL_BIND || undefined, () => log(`[content] http://localhost:${port}`));
  server.on("error", (error) => {
    err("[content] failed to listen", error.message);
    process.exit(1);
  });
}).catch((error) => {
  err("[content] failed to start", error?.message || error);
  process.exit(1);
});

