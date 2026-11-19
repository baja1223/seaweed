export const log = (...args) => console.log("[buttblastr]", ...args);
export const err = (...args) => console.error("[buttblastr:ERR]", ...args);

const WEAK_SECRETS = new Set([
  "changeme_access",
  "changeme_refresh",
  "change_me_access",
  "change_me_refresh",
  "dev_access_secret_change_me",
  "dev_refresh_secret_change_me"
]);

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "57P01",
  "57P02",
  "57P03",
  "53300"
]);

export function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (!missing.length) return;
  err(`Missing required environment: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

export function assertProductionSecrets() {
  if (process.env.NODE_ENV !== "production") return;
  const secrets = [process.env.JWT_ACCESS_SECRET, process.env.JWT_REFRESH_SECRET];
  if (secrets.some((secret) => !secret || WEAK_SECRETS.has(secret))) {
    err("Refusing to start in production with an example JWT secret. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.");
    process.exit(1);
  }
}

export function corsOrigin() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw.trim() === "*" || raw.trim() === "true") return true;
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return list.length === 1 ? list[0] : list;
}

export function isTransientDbError(error) {
  if (!error) return false;
  if (TRANSIENT_CODES.has(error.code)) return true;
  if (Array.isArray(error.errors) && error.errors.some((item) => isTransientDbError(item))) return true;
  const text = `${error.name || ""} ${error.message || ""}`;
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|timed out|timeout|starting up|Socket closed|Connection is closed|Server selection/i.test(text);
}

export async function retry(label, fn, { attempts = 30, delayMs = 1000 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isTransientDbError(error) || attempt === attempts) throw error;
      log(`${label} not ready (${attempt}/${attempts}): ${error.message || error.code || error.name}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}
