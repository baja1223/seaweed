import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { connectMongo } from "./auth_db.js";
import { ensureOperator } from "./auth_operator.js";
import routes from "./auth_routes.js";
import { assertProductionSecrets, corsOrigin, err, log, requireEnv } from "./Common Utilities.js";

requireEnv(["MONGO_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]);
assertProductionSecrets();

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigin(), credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "auth",
  operatorSeed: true
}));
app.use("/api/auth", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
}, routes);

const port = Number(process.env.AUTH_PORT || 4000);
connectMongo(process.env.MONGO_URI).then(async () => {
  await ensureOperator();
  const server = app.listen(port, process.env.LOCAL_BIND || undefined, () => log(`[auth] http://localhost:${port}`));
  server.on("error", (error) => {
    err("[auth] failed to listen", error.message);
    process.exit(1);
  });
}).catch((error) => {
  err("[auth] failed to start", error?.message || error);
  process.exit(1);
});
