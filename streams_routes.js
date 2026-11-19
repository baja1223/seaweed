import { Router } from "express";
import { authorizeMedia, endStream, listStreams, manageStreams, requireStreamer, startStream } from "./streams_controllers.js";

const r = Router();
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

r.post("/stream/start", requireStreamer, handle(startStream));
r.post("/stream/end", requireStreamer, handle(endStream));
r.get("/stream/manage", requireStreamer, handle(manageStreams));
r.get("/streams", handle(listStreams));
r.post("/media/authorize", handle(authorizeMedia));

export default r;
