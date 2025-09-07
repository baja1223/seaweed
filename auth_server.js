import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { connectMongo } from "./db.js";
import routes from "./routes.js";
import { log } from "../common/logger.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true, service: "auth" }));
app.use("/api/auth", routes);

const port = Number(process.env.AUTH_PORT || 4000);
connectMongo(process.env.MONGO_URI).then(() => {
  app.listen(port, () => log(`[auth] http://localhost:${port}`));
});
