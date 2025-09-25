import "dotenv/config";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const procs = [];

function run(name, relPath) {
  const file = path.join(__dirname, relPath);
  const p = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  procs.push(p);
  console.log(`[dev] started ${name}`);
}

// Point to the root-level service entry files
run("auth", "auth_server.js");
run("chat", "chat_server.js");
run("streams", "streams_server.js");
run("content", "content_server.js");

process.on("SIGINT", () => {
  for (const p of procs) try { p.kill(); } catch {}
  process.exit(0);
});
