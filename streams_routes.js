import { Router } from "express";
import { authorizeMedia, createClip, deleteRecording, endStream, getClip, listClips, listRecordings, listStreams, manageStreams, requireStreamer, setStreamRecording, startStream } from "./streams_controllers.js";

const r = Router();
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const uuid = ":id([0-9a-f-]{36})";

r.post("/stream/start", requireStreamer, handle(startStream));
r.post("/stream/end", requireStreamer, handle(endStream));
r.post("/stream/record", requireStreamer, handle(setStreamRecording));
r.get("/stream/manage", requireStreamer, handle(manageStreams));
r.get("/streams", handle(listStreams));
r.get("/recordings", handle(listRecordings));
r.delete(`/recordings/${uuid}`, requireStreamer, handle(deleteRecording));
r.get("/clips", handle(listClips));
r.get(`/clips/${uuid}`, handle(getClip));
r.post("/clips", requireStreamer, handle(createClip));
r.post("/media/authorize", handle(authorizeMedia));

export default r;
