import { createClient } from "redis";
import { err, log } from "../Common Utilities.js";

const HISTORY_MAX = 50; // messages per room

export async function createRedis(url) {
  const client = createClient({ url });
  client.on("error", (e) => err("[chat][redis]", e));
  await client.connect();
  log("[chat][redis] connected");
  return client;
}

export async function pushMessage(client, room, messageObj) {
  const key = `room:${room}:history`;
  await client.lPush(key, JSON.stringify(messageObj));
  await client.lTrim(key, 0, HISTORY_MAX - 1);
}

export async function getHistory(client, room) {
  const key = `room:${room}:history`;
  const raw = await client.lRange(key, 0, HISTORY_MAX - 1);
  return raw.map((x) => JSON.parse(x)).reverse(); // oldest-first
}
