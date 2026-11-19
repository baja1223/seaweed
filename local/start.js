import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const directory = join(homedir(), ".pulseplay-local");
const local = parse(readFileSync(join(directory, "runtime.env")));
try {
  writeFileSync(join(directory, "audit.key"), randomBytes(32), { mode: 0o600, flag: "wx" });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const root = fileURLToPath(new URL("../", import.meta.url));
const services = ["auth_server.js", "chat_server.js", "streams_server.js", "local/site.js"];
const selected = process.argv.slice(2);
if (selected.some((file) => !services.includes(file))) throw new Error("Unknown PulsePlay service.");
const pidFile = join(directory, "pids.json");
let processes = {};
if (selected.length) processes = JSON.parse(readFileSync(pidFile, "utf8"));
for (const file of selected.length ? selected : services) {
  const log = openSync(join(directory, `${file.split("/").pop()}.log`), "a", 0o600);
  const service = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, ...local },
    detached: true,
    stdio: ["ignore", log, log]
  });
  closeSync(log);
  service.unref();
  processes[file] = service.pid;
}
writeFileSync(pidFile, JSON.stringify(processes, null, 2), { mode: 0o600 });
