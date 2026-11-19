import { createClient } from "redis";
import { err, log, retry } from "./Common Utilities.js";

const HISTORY_MAX = 50; // messages per room

export async function createRedis(url) {
  return retry("[chat][redis]", async () => {
    const client = createClient({
      url,
      socket: { connectTimeout: 2000, reconnectStrategy: false }
    });
    client.on("error", () => {});
    try {
      await client.connect();
    } catch (error) {
      client.removeAllListeners();
      client.on("error", () => {});
      await client.disconnect().catch(() => {});
      throw error;
    }
    client.removeAllListeners("error");
    client.on("error", (error) => err("[chat][redis]", error?.message || error));
    log("[chat][redis] connected");
    return client;
  });
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
