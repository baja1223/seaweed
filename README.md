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
| Frontend  | http://127.0.0.1:4173           | Page, `/api/...`, and chat at `/ws`               |
| Auth      | http://127.0.0.1:4000           | Register, login, refresh, and `/api/auth/profile` |
| Chat      | http://127.0.0.1:4173/ws        | WebSocket rooms, history stored in Redis          |
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

## Operator login

A fresh boot creates one operator account. Auth does this every time it starts, so you do not create the account by hand and you do not set `OPERATOR_USER_ID`.

| Field    | Local default              |
|----------|----------------------------|
| Username | `operator`                 |
| Email    | `operator@example.com`     |
| Password | `operator-local-change-me` |

Sign in with the username or the email. The header shows **(operator)**, and **Operator controls** can create an OBS broadcast (a stream key) without a media server.

Change the password in a `.env` file before anyone else can open the site:

```sh
# .env
OPERATOR_PASSWORD=choose-a-long-password
```

Then `docker compose up -d` again. Auth updates the existing operator to that password. You do not need `docker compose down -v` for a password change. Wipe the databases with `down -v` only when you want to delete every account and stream.

Anyone else uses **Create account**. That signup is a normal viewer. It can chat and create a browser stream key. It cannot open **Operator controls**.

## Try it in the browser

1. Open http://127.0.0.1:4173.
2. Sign in as `operator` with the password above, or open **Create account** and make a new viewer. Usernames are 3–32 letters, numbers, `.`, `_`, or `-`. Passwords are at least 8 characters.
3. The header should switch to "Signed in as …". Chat connects to the `lobby` room through `/ws` on the same address as the page.
4. Type a message and press **Send**. It shows up in the chat box. A second browser window signed in as another user, joined to `lobby`, receives it too. Refreshing the page reloads recent messages from Redis.
5. In **Broadcast from this browser**, enter a title and press **Create stream key**. The key appears on the page, and **Watch &lt;title&gt;** appears in the stream list. Signed in as the operator, **Create broadcast** does the same for an OBS-style stream.

**Go live** and the video player need a media server (Phase 2). Creating a stream key does not. Each account can have one active browser stream; end it before creating another.

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

Compose sets its own database hostnames (`mongo`, `redis`, `postgres`). A `.env` file on your machine is picked up for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `PGPASSWORD`, `CORS_ORIGIN`, `WEB_HOSTS`, `OPERATOR_USERNAME`, `OPERATOR_EMAIL`, and `OPERATOR_PASSWORD`. Database URLs inside Compose stay on the Docker network so a laptop `.env` cannot point a container at `127.0.0.1` by accident.

Before a public deploy, replace the JWT secrets and `OPERATOR_PASSWORD`. If `NODE_ENV=production` and a secret or the operator password is still an example value, auth refuses to start.

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
Browser  http://127.0.0.1:4173   (or https://your.domain)
   |-- /api/auth/*     -> Auth (MongoDB) -> JWT
   |-- /api/stream*    -> Streams (Postgres)
   |-- /api/content/*  -> Content (MongoDB)
   \-- /ws             -> Chat (Redis history)

Phase 2 (not started by the command above)
OBS or browser WebRTC -> RTMP/WHIP -> HLS -> the player
```

`/api/stream/start` with `{"title":"...","source":"browser"}` returns `id` and `streamKey`. `GET /api/streams` lists rows that have not ended. When `MEDIA_CONTROL_URL` is set, that list is narrowed to streams MediaMTX currently reports as publishing.

## Share a link from your Mac

The page, the APIs, and chat all use port **4173**. A tunnel only has to forward that one port. This works only while your Mac is on and the stack is running. Change `OPERATOR_PASSWORD` in `.env` and run `docker compose up -d` before you send the link to anyone.

```sh
brew install cloudflared
docker compose up -d
cloudflared tunnel --url http://127.0.0.1:4173
```

Cloudflare prints an `https://….trycloudflare.com` address. Open that. Create account and sign in work there. Chat uses `wss://` on the same host because the page is HTTPS. Stop the tunnel with Ctrl+C. The link dies when you do.

If you copied an older `.env` that sets `WEB_HOSTS` to only `127.0.0.1,localhost`, change it to `WEB_HOSTS=*` (or add the tunnel hostname) and run `docker compose up -d` again. Otherwise the public address is refused.

## Permanent deploy on one VPS

A Hetzner CX22, a DigitalOcean basic droplet, or a similar $4–6/month machine is enough. Point a DNS name (for example `live.example.com`) at the VPS, then:

```sh
git clone https://github.com/baja1223/seaweed.git
cd seaweed
cp .env.example .env
```

Put real values in `.env`. Production will not boot with the examples:

```sh
SITE_ADDRESS=live.example.com
JWT_ACCESS_SECRET=paste-a-long-random-string
JWT_REFRESH_SECRET=paste-a-different-long-random-string
OPERATOR_PASSWORD=paste-a-long-password
PGPASSWORD=paste-a-database-password
```

`openssl rand -hex 32` is a fine way to make the two JWT secrets.

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`docker-compose.prod.yml` adds Caddy on ports 80 and 443. `Caddyfile` reverse-proxies `SITE_ADDRESS` to the frontend container, including WebSocket upgrades for `/ws`. Caddy gets the HTTPS certificate by itself. MongoDB, Redis, and Postgres stay bound to `127.0.0.1` on the VPS. Do not open 27017, 6379, 5432, or 4000–4003 on the firewall.

Open `https://live.example.com`. The operator signs in with `OPERATOR_USERNAME` (default `operator`) and the password you set. Everyone else uses **Create account**.

`k8s/` is a sketch of the same containers for later. Build the root Dockerfile, push it as one image, and replace the placeholder JWT and database passwords before anyone else can reach the cluster. See `k8s/README.md`.

## Troubleshooting

- **A service exits with "Missing required environment".** For `npm run dev`, copy `.env.example` to `.env`. Compose does not need that file.
- **Auth cannot reach Mongo, or streams cannot reach Postgres.** Wait until `docker compose ps` shows the databases as healthy, then start the apps again. The Node services retry for about 30 seconds.
- **Register returns 500 right after you set `LOCAL_BIND=127.0.0.1`.** Unset `LOCAL_BIND`, or follow `local/README.md` to create the audit key.
- **Create stream key says you already have a browser broadcast.** Press **End** on the existing one, then create another.
- **The page loads and the stream is listed, but the player says the standby film is unavailable.** That file is optional. Playback of real video is Phase 2. The stream record and chat still work.
- **Operator login says "invalid credentials".** Use username `operator` and password `operator-local-change-me`, unless you set `OPERATOR_PASSWORD` in `.env`. Pull the latest code and run `docker compose up --build -d`. You do not need `docker compose down -v` unless you want an empty database. Auth creates or updates the operator when it starts. The auth logs print the local default login.
- **Port already in use.** Stop the other copy with `docker compose down`, or change the published port in `docker-compose.yml`.
