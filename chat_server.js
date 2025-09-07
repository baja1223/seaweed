import "dotenv/config";
import { WebSocketServer } from "ws";
import { verifyAccess } from "../common/jwt.js";
import { createRedis, pushMessage, getHistory } from "./history.js";
import { log } from "../common/logger.js";
import http from "http";

const PORT = Number(process.env.CHAT_PORT || 4001);
const redis = await createRedis(process.env.REDIS_URL);

// naive in-memory room registry: { room => Set<socket> }
const rooms = new Map();

function joinRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws._room = room;
}

function leaveRoom(ws) {
  if (!ws._room) return;
  const set = rooms.get(ws._room);
  if (set) set.delete(ws);
  ws._room = null;
}

function broadcast(room, payload) {
  const set = rooms.get(room);
  if (!set) return;
  for (const sock of set) {
    if (sock.readyState === sock.OPEN) {
      sock.send(JSON.stringify(payload));
    }
  }
}

const server = http.createServer((req, res) => {
  // simple health endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "chat" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws, req) => {
  try {
    // Expect: ws://host:4001?room=<room>&token=<JWT>
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const room = params.get("room");
    const token = params.get("token");
    if (!room || !token) return ws.close(1008, "room and token required");

    const decoded = verifyAccess(token); // throws if invalid
    ws._user = { id: decoded.sub, username: decoded.username };
    joinRoom(ws, room);

    // send recent history
    const history = await getHistory(redis, room);
    ws.send(JSON.stringify({ type: "history", data: history }));

    ws.on("message", async (buf) => {
      let text = "";
      try { text = buf.toString(); } catch { return; }
      if (!text.trim()) return;

      const msg = {
        type: "message",
        room,
        user: { id: ws._user.id, username: ws._user.username },
        text,
        ts: Date.now()
      };
      await pushMessage(redis, room, msg);
      broadcast(room, msg);
    });

    ws.on("close", () => leaveRoom(ws));
  } catch {
    ws.close(1008, "invalid token");
  }
});

server.listen(PORT, () => log(`[chat] ws://localhost:${PORT}`));
