import { Router } from "express";
import { startStream, endStream, listStreams } from "./controllers.js";

const r = Router();

r.post("/stream/start", startStream);
r.post("/stream/end", endStream);
r.get("/streams", listStreams);

export default r;
