import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const services = [
  ["auth", "auth_server.js"],
  ["chat", "chat_server.js"],
  ["streams", "streams_server.js"],
  ["content", "content_server.js"],
  ["frontend", path.join("local", "site.js")]
];

const children = [];

function start([name, relPath]) {
  const child = spawn(process.execPath, [path.join(root, relPath)], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.error(`[dev] ${name} exited (${code ?? "unknown"})`);
  });
  console.log(`[dev] started ${name}`);
}

console.log("[dev] Starting auth, chat, streams, content, and the frontend.");
console.log("[dev] Databases must already be running. See the README.");
for (const service of services) start(service);

function stop() {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
