import "dotenv/config";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./common/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const procs = [];

function run(name, file) {
  const p = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  procs.push([name, p]);
  log(`started ${name}`);
}

run("auth", path.join(__dirname, "auth", "server.js"));
run("chat", path.join(__dirname, "chat", "server.js"));
run("streams", path.join(__dirname, "streams", "server.js"));

process.on("SIGINT", () => {
  procs.forEach(([_, p]) => p.kill());
  process.exit(0);
});
