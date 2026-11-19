# seaweed (buttblastr core)

**Author:** Taha Z
**Repo:** https://github.com/baja1223/seaweed

Seaweed is the core of **buttblastr**, a Kick/Twitch-style livestreaming platform.
It is split into **Auth**, **real-time chat**, **stream management**, **content**, and a small **frontend**.
Video ingest (RTMP / HLS) is a later phase. This repository runs the accounts, chat, stream records, and the page that talks to them.

User records default `author` to **"john seaweed"** when no author is supplied.

## What you need

- [Docker](https://docs.docker.com/get-docker/) with Compose v2. This is the path to use if you are new to the project.
- Or, to run the Node apps yourself: **Node.js 20 or newer**, plus MongoDB 7, Redis 7, and PostgreSQL 16. Docker can still run just the databases.

Nothing in this repo needs an API key for local use.

## Run everything with one command

From the repository root:

```sh
docker compose up --build
```

The first run downloads images and installs Node dependencies. When the logs show the auth, chat, streams, content, and PulsePlay lines, open:

**http://127.0.0.1:4173**

Leave that terminal open. Stop the stack with Ctrl+C, then `docker compose down`.

| Service   | Address                         | What it does                                      |
|-----------|---------------------------------|---------------------------------------------------|
| Frontend  | http://127.0.0.1:4173           | Page, plus a proxy to the HTTP APIs               |
| Auth      | http://127.0.0.1:4000           | Register, login, refresh, and `/api/auth/profile` |
| Chat      | ws://127.0.0.1:4001             | WebSocket rooms, history stored in Redis          |
| Streams   | http://127.0.0.1:4002           | Start, end, and list streams (Postgres)           |
| Content   | http://127.0.0.1:4003           | Simple title/description items (MongoDB)          |
| MongoDB   | 127.0.0.1:27017                 | Auth database and content database                |
| Redis     | 127.0.0.1:6379                  | Last 50 chat messages per room                    |
| Postgres  | 127.0.0.1:5432                  | Stream rows. Database `buttblastr`, user `postgres` |

Compose applies `streams_schema.sql` when Postgres first starts, and the streams service applies that same file again on boot so the tables exist even if the data volume was created earlier.

Docker Compose has local defaults, so you do not need a `.env` file for this command. Ports are bound to `127.0.0.1` on your machine.

## Run the apps without Docker

Use this when you want to edit the Node code and restart quickly.

1. Start the databases. With Docker installed, this is enough:

   ```sh
   docker compose up -d mongo redis postgres
   ```

   If you already installed MongoDB, Redis, and PostgreSQL yourself, create a database named `buttblastr` owned by user `postgres` with password `postgres_password`, and leave Mongo and Redis on their default ports with no password.

2. Install Node dependencies and create the env file:

   ```sh
   cp .env.example .env
   npm ci
   ```

3. Start auth, chat, streams, content, and the page:

   ```sh
   npm run dev
   ```

4. Open **http://127.0.0.1:4173**.

`npm run dev` runs `src/index.js`, which starts:

- `auth_server.js`
- `chat_server.js`
- `streams_server.js`
- `content_server.js`
- `local/site.js` (the page)

You can start one of them with `npm run dev:auth`, `dev:chat`, `dev:streams`, `dev:content`, or `dev:frontend`.

## Try it in the browser

1. Open http://127.0.0.1:4173.
2. Open **Create account**. Use a username of 3–32 letters, numbers, `.`, `_`, or `-`, a real-looking email, and a password of at least 8 characters.
3. The header should switch to "Signed in as …". Chat connects to the `lobby` room.
4. Type a message and press **Send**. It shows up in the chat box. A second browser window signed in as another user, joined to `lobby`, receives it too. Refreshing the page reloads recent messages from Redis.
5. In **Broadcast from this browser**, enter a title and press **Create stream key**. The key appears on the page, and **Watch &lt;title&gt;** appears in the stream list.

**Go live** and the video player need a media server (Phase 2). Creating a stream key does not. OBS-style streams (`source: "obs"`) are limited to the account id in `OPERATOR_USER_ID`. Browser streams, which is what the button creates, work for every signed-in account. Each account can have one active browser stream; end it before creating another.

The folder `frontend/` is an optional Next.js HLS player for later. It is not started by `docker compose up`. To look at it: `cd frontend && npm ci && npm run dev`, then open http://127.0.0.1:3000. Install `hls.js` in that folder before using `/player`.

## Check from the terminal

With the stack running and Node 20+ installed:

```sh
node scripts/check.js
```

Or `npm run check` after `npm ci`. The script registers a user, logs in, calls `/profile`, starts a stream, checks that it is listed, exchanges chat messages, saves a content item, and loads the page.

The same steps by hand:

```sh
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4001/health
curl -s http://127.0.0.1:4002/health
curl -s http://127.0.0.1:4003/health
curl -s http://127.0.0.1:4173/health

curl -s -X POST http://127.0.0.1:4173/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"ada","email":"ada@example.com","password":"Demo123!"}'
```

Copy `accessToken` from that JSON, then:

```sh
curl -s http://127.0.0.1:4173/api/auth/profile \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN"

curl -s -X POST http://127.0.0.1:4173/api/stream/start \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN" \
  -d '{"title":"First stream","source":"browser"}'

curl -s http://127.0.0.1:4173/api/streams
```

Login is `POST /api/auth/login` with `{"emailOrUsername":"ada@example.com","password":"Demo123!"}`.

## Environment variables

`.env.example` lists every variable. Copy it to `.env` for `npm run dev`.

Compose sets its own database hostnames (`mongo`, `redis`, `postgres`). A `.env` file on your machine is only picked up for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `PGPASSWORD`, `CORS_ORIGIN`, and `OPERATOR_USER_ID`. Database URLs inside Compose stay on the Docker network so a laptop `.env` cannot point a container at `127.0.0.1` by accident.

Before a public deploy, replace the JWT secrets. If `NODE_ENV=production` and a secret is still one of the example values, auth and chat refuse to start.

Leave `LOCAL_BIND` unset unless you have already created the PulsePlay audit key described in `local/README.md`. Setting `LOCAL_BIND=127.0.0.1` turns on that encrypted journal, and registration fails when the key file is missing.

## Layout

These files are the services that start:

- `auth_server.js` and `auth_*.js` — accounts in MongoDB
- `chat_server.js`, `chat_history.js` — WebSocket chat
- `streams_server.js`, `streams_*.js`, `streams_schema.sql` — streams in Postgres
- `content_server.js`, `content_*.js` — content items in MongoDB
- `common_jwt.js`, `Common Utilities.js` — tokens, logs, shared helpers
- `index.html`, `index.js`, `styles.css`, `broadcast.js` — the page
- `local/site.js` — serves that page and proxies `/api/...` to the services
- `Dockerfile`, `docker-compose.yml` — one image, one command

`src/auth/` and `src/common/` are an older partial copy. They are not what Compose or `npm run dev` starts. `src/legacy-demo-client.js` is an earlier browser demo. `src/index.js` is only the local process launcher.

`local/` also contains the optional MediaMTX / OBS test. That path is separate from `docker compose up` and is described in `local/README.md`.

## How the pieces connect

```text
Browser  http://127.0.0.1:4173
   |-- /api/auth/*     -> Auth (MongoDB) -> JWT
   |-- /api/stream*    -> Streams (Postgres)
   |-- /api/content/*  -> Content (MongoDB)
   \-- ws://host:4001  -> Chat (Redis history)

Phase 2 (not started by the command above)
OBS or browser WebRTC -> RTMP/WHIP -> HLS -> the player
```

`/api/stream/start` with `{"title":"...","source":"browser"}` returns `id` and `streamKey`. `GET /api/streams` lists rows that have not ended. When `MEDIA_CONTROL_URL` is set, that list is narrowed to streams MediaMTX currently reports as publishing.

## Deploying online later

The cheapest setup that matches this repo is **one small Linux VPS running Docker Compose**. A Hetzner CX22, a DigitalOcean basic droplet, or a similar $4–6/month machine is enough for a demo.

1. Install Docker on the VPS.
2. Clone the repo and create a `.env` with long random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values, plus a new `PGPASSWORD`.
3. Run `docker compose up -d --build`.
4. Install Caddy (or nginx) on the host for HTTPS. Proxy the site to `127.0.0.1:4173`. Proxy WebSocket upgrades on a hostname such as `chat.example.com` to `127.0.0.1:4001`.
5. Set `WEB_HOSTS` to your site hostname (or `*` behind that proxy) and `CORS_ORIGIN` to `https://your.domain`. Rebuild or restart the frontend and auth containers with those variables.
6. Leave MongoDB, Redis, and Postgres bound to `127.0.0.1`. The Compose file already does that. Do not open 27017, 6379, or 5432 on the firewall.

A managed split is the other cheap option if you do not want to run databases yourself:

- MongoDB Atlas (free tier) for `MONGO_URI` and `CONTENT_MONGO_URI`
- Upstash Redis (free tier) for `REDIS_URL`
- Neon or Supabase Postgres (free tier) for `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`
- A small Node host (Fly.io, Render, or Railway) running the same Dockerfile four times, plus once as `node local/site.js`

`k8s/` is a sketch of the same containers for later. Build the root Dockerfile, push it as one image, and replace the placeholder JWT and database passwords before anyone else can reach the cluster. See `k8s/README.md`.

## Troubleshooting

- **A service exits with "Missing required environment".** For `npm run dev`, copy `.env.example` to `.env`. Compose does not need that file.
- **Auth cannot reach Mongo, or streams cannot reach Postgres.** Wait until `docker compose ps` shows the databases as healthy, then start the apps again. The Node services retry for about 30 seconds.
- **Register returns 500 right after you set `LOCAL_BIND=127.0.0.1`.** Unset `LOCAL_BIND`, or follow `local/README.md` to create the audit key.
- **Create stream key says you already have a browser broadcast.** Press **End** on the existing one, then create another.
- **The page loads and the stream is listed, but the player says the standby film is unavailable.** That file is optional. Playback of real video is Phase 2. The stream record and chat still work.
- **Port already in use.** Stop the other copy with `docker compose down`, or change the published port in `docker-compose.yml`.
