#!/usr/bin/env bash
# Prints why operator login works or fails on this machine.
# Works on the macOS bash and on a Linux bash, with Docker and curl.
set -u
cd "$(dirname "$0")/.."

failures=0
note() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; failures=1; }
ok() { printf 'ok   %s\n' "$*"; }

note "PulsePlay doctor"
note "repo: $(pwd)"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  commit="$(git rev-parse --short HEAD)"
  note "git:  ${branch} @ ${commit}"
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    fail "this checkout is ${branch}. The operator account is on cursor/local-boot-5f66 (PR #1), which is not merged."
    note "     git fetch origin && git checkout cursor/local-boot-5f66 && git pull && docker compose up --build -d"
  fi
else
  fail "this folder is not a git checkout"
fi

if [ ! -f auth_operator.js ]; then
  fail "auth_operator.js is missing, so this code cannot seed the operator"
  note "     git fetch origin && git checkout cursor/local-boot-5f66 && git pull"
else
  ok "this checkout contains the operator seed"
fi

if docker info >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
  docker_cmd() { docker "$@"; }
elif sudo docker info >/dev/null 2>&1; then
  compose() { sudo docker compose "$@"; }
  docker_cmd() { sudo docker "$@"; }
else
  fail "Docker is not running"
  note "Start Docker Desktop, then run: docker compose up --build -d"
  exit 1
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

container_hash() {
  compose exec -T "$1" node --input-type=module -e \
    'import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' \
    "$2" 2>/dev/null || true
}

note ""
note "containers:"
compose ps || failures=1

for file in auth_operator.js index.js; do
  [ -f "$file" ] || continue
  host_hash="$(hash_file "$file")"
  for service in auth frontend; do
    running="$(compose ps --status running -q "$service" 2>/dev/null || true)"
    if [ -z "$running" ]; then
      fail "${service} is not running"
      continue
    fi
    image_hash="$(container_hash "$service" "$file")"
    if [ -z "$image_hash" ]; then
      fail "${service} is running an image from before ${file} existed"
    elif [ "$image_hash" = "$host_hash" ]; then
      ok "${service} is running this checkout's ${file}"
    else
      fail "${service} is running an older ${file} than this checkout"
    fi
  done
done

if [ "$failures" -ne 0 ]; then
  note "Rebuild without deleting accounts: docker compose up --build -d"
  note "docker compose down -v only wipes accounts and streams. It is not required to fix login."
fi

note ""
health="$(curl -fsS --max-time 5 http://127.0.0.1:4000/health 2>/dev/null || true)"
page="$(curl -fsS --max-time 5 http://127.0.0.1:4173/health 2>/dev/null || true)"
note "auth health:     ${health:-unreachable}"
note "frontend health: ${page:-unreachable}"
if ! printf '%s' "$health" | grep -q '"operatorSeed":true'; then
  fail "auth is not the version that seeds the operator"
  note "Recent auth logs:"
  compose logs auth --tail 30 || true
fi

username="$(compose exec -T auth printenv OPERATOR_USERNAME 2>/dev/null | tr -d '\r' || true)"
email="$(compose exec -T auth printenv OPERATOR_EMAIL 2>/dev/null | tr -d '\r' || true)"
password="$(compose exec -T auth printenv OPERATOR_PASSWORD 2>/dev/null | tr -d '\r' || true)"
hosts="$(compose exec -T frontend printenv WEB_HOSTS 2>/dev/null | tr -d '\r' || true)"
note "operator username in the auth container: ${username:-unknown}"
note "operator email in the auth container:    ${email:-unknown}"
if [ "$password" = "operator-local-change-me" ]; then
  note "operator password: operator-local-change-me (the local default)"
elif [ -n "$password" ]; then
  note "operator password: a custom OPERATOR_PASSWORD from .env (${#password} characters, not printed)"
else
  fail "the auth container has no OPERATOR_PASSWORD"
fi
note "frontend WEB_HOSTS: ${hosts:-unknown}"
if [ -n "$hosts" ] && [ "$hosts" != "*" ]; then
  fail "WEB_HOSTS is restrictive, so a public link is rejected. The Compose file should set it to *."
fi
note "Compose uses mongodb://mongo:27017/buttblastr_auth. A MONGO_URI in .env applies to npm run dev, not to Docker."

note ""
note "mongo users matching the operator:"
if [ -n "$username" ]; then
  compose exec -T \
    -e "DOCTOR_USER=$username" -e "DOCTOR_EMAIL=$email" auth \
    node --input-type=module -e '
      import mongoose from "mongoose";
      await mongoose.connect(process.env.MONGO_URI);
      const username = process.env.DOCTOR_USER;
      const email = process.env.DOCTOR_EMAIL;
      const rows = await mongoose.connection.collection("users").find(
        { $or: [{ username }, { email }] },
        { projection: { username: 1, email: 1 } }
      ).toArray();
      if (!rows.length) console.log("none");
      for (const row of rows) console.log(String(row._id) + "  " + row.username + "  " + row.email);
      await mongoose.disconnect();
    ' || fail "could not read Mongo from the auth container"
else
  fail "skipped the Mongo lookup because the operator username is empty"
fi

note ""
if [ -z "$username" ] || [ -z "$password" ]; then
  fail "skipped the login test"
else
  payload="$(compose exec -T \
    -e "DOCTOR_USER=$username" -e "DOCTOR_PASSWORD=$password" auth \
    node --input-type=module -e 'process.stdout.write(JSON.stringify({ emailOrUsername: process.env.DOCTOR_USER, password: process.env.DOCTOR_PASSWORD }))')"
  raw="$(curl -sS --max-time 10 -w $'\n%{http_code}' -H 'content-type: application/json' --data-binary "$payload" http://127.0.0.1:4173/api/auth/login 2>/dev/null || true)"
  code="$(printf '%s\n' "$raw" | tail -n 1)"
  body="$(printf '%s\n' "$raw" | sed '$d')"
  note "login test as ${username} via http://127.0.0.1:4173:"
  if printf '%s' "$body" | grep -q '"operator":true'; then
    ok "status ${code} operator true"
    if [ "$password" = "operator-local-change-me" ]; then
      note "Sign in as ${username} or ${email} with password operator-local-change-me."
    else
      note "Sign in as ${username} or ${email} with the OPERATOR_PASSWORD in your .env. The printed default will not work."
    fi
  else
    fail "status ${code} ${body}"
    note "Recent auth logs:"
    compose logs auth --tail 20 || true
  fi
fi

note ""
note "media server:"
if docker_cmd ps -a --format '{{.Names}}' | grep -qx 'pulseplay-media-media-1'; then
  fail "pulseplay-media-media-1 is still here. It binds 1935, 8888, 9997, 8189/udp, and 8890, so this stack cannot publish RTMP or WebRTC."
  note "Remove that old container, then start again. This keeps your accounts:"
  note "  docker rm -f pulseplay-media-media-1"
  note "  docker compose up --build -d"
fi
media_id="$(compose ps --status running -q media 2>/dev/null || true)"
if [ -z "$media_id" ]; then
  fail "media is not running"
  note "If docker compose up said 1935 or 8189 is already allocated, remove the old container above and run docker compose up --build -d"
else
  ok "media container is running"
  media_api="$(compose exec -T streams node --input-type=module -e 'const response = await fetch("http://media:9997/v3/paths/list"); if (!response.ok) process.exit(1); process.stdout.write(String(response.status));' 2>/dev/null || true)"
  if [ "$media_api" = "200" ]; then
    ok "streams can reach the media API"
  else
    fail "streams could not reach http://media:9997/v3/paths/list"
  fi
  whip_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'content-type: application/sdp' --data 'v=0' http://127.0.0.1:4173/00000000-0000-4000-8000-000000000000/whip || true)"
  if [ "$whip_code" = "502" ] || [ -z "$whip_code" ] || [ "$whip_code" = "000" ]; then
    fail "port 4173 did not proxy /whip (status ${whip_code:-none})"
  else
    ok "port 4173 proxies /whip (status ${whip_code})"
  fi
  recordings="$(compose exec -T media sh -c 'test -d /recordings && echo yes' 2>/dev/null || true)"
  if [ "$recordings" = "yes" ]; then
    ok "recordings directory is mounted"
  else
    fail "media cannot see /recordings"
  fi
  playback_code="$(compose exec -T streams node --input-type=module -e 'const response = await fetch("http://media:9996/list?path=00000000-0000-4000-8000-000000000000"); process.stdout.write(String(response.status));' 2>/dev/null || true)"
  case "$playback_code" in
    200|400|401|403|404) ok "playback server answered ${playback_code}" ;;
    *) fail "playback server did not answer (status ${playback_code:-none})" ;;
  esac
  front_playback="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 'http://127.0.0.1:4173/playback/list?path=00000000-0000-4000-8000-000000000000' || true)"
  if [ "$front_playback" = "502" ] || [ -z "$front_playback" ] || [ "$front_playback" = "000" ]; then
    fail "port 4173 did not proxy playback (status ${front_playback:-none})"
  else
    ok "port 4173 proxies playback (status ${front_playback})"
  fi
fi

note ""
if [ "$failures" -eq 0 ]; then
  note "Doctor found nothing wrong with operator login or the media server."
  exit 0
fi
note "Fix: git fetch origin && git checkout cursor/local-boot-5f66 && git pull && docker compose up --build -d"
note "If an old MediaMTX container is holding the ports: docker rm -f pulseplay-media-media-1"
note "Do not run docker compose down -v unless you want an empty database. Auth resets the operator password on startup."
exit 1
