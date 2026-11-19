import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = join(homedir(), ".pulseplay-local");
const journal = join(directory, "activity.jsonl");
const encryptionKey = async () => {
  const key = await readFile(join(directory, "audit.key"));
  if (key.length !== 32) throw new Error("Invalid audit key.");
  return key;
};

export async function audit(event, accountId, streamId) {
  if (process.env.LOCAL_BIND !== "127.0.0.1") return;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  const entry = JSON.stringify({ at: new Date().toISOString(), event, accountId: String(accountId), streamId });
  const ciphertext = Buffer.concat([cipher.update(entry), cipher.final()]);
  const line = Buffer.from(JSON.stringify({
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64")
  }) + "\n");
  const handle = await open(journal, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const { bytesWritten } = await handle.write(line);
    if (bytesWritten !== line.length) throw new Error("Incomplete audit write.");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = await encryptionKey();
  for (const line of (await readFile(journal, "utf8")).trim().split("\n")) {
    const envelope = JSON.parse(line);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    console.log(Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()
    ]).toString());
  }
}
