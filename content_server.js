import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { connectMongo } from "./content_db.js";
import routes from "./content_routes.js";
import { log } from "./Common Utilities.js";

const app = express();
app.use(helmet());
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true, service: "content" }));
app.use("/api/content", routes);

const port = Number(process.env.CONTENT_PORT || 4003);
connectMongo(process.env.MONGO_URI).then(() => {
  app.listen(port, () => log(`[content] http://localhost:${port}`));
});

