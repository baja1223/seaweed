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
| RTMP      | 127.0.0.1:1935                  | OBS ingest. Not used by the browser                 |
| WebRTC UDP| 127.0.0.1:8189                  | Camera media for a browser on this computer         |

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

Pull request #1 is not on `main`. `git pull` while you are on `main` does not bring this login. From the repo on your Mac:

```sh
git fetch origin
git checkout cursor/local-boot-5f66
git pull
docker compose up --build -d
bash scripts/doctor.sh
```

`--build` matters. `docker compose up -d` without it keeps the old image, which has no operator account. You do **not** need `docker compose down -v`. That command deletes every account and stream. Auth resets the operator password to `OPERATOR_PASSWORD` every time it starts, including when an older database already has a user named `operator`.

| Field    | Local default              |
|----------|----------------------------|
| Username | `operator`                 |
| Email    | `operator@example.com`     |
| Password | `operator-local-change-me` |

Sign in with the username or the email. The page does not show this username, email, or password, and the sign-in boxes start empty. The page says **No such user** or **Wrong password** when it can tell those apart, and **Server unreachable** when auth is not running. The username and password stay in this README and in the output of `bash scripts/doctor.sh` on the computer running PulsePlay. The header shows **(operator)**. **Go live** uses the camera and microphone. **Operator controls** creates an OBS broadcast.

`bash scripts/doctor.sh` (or `npm run doctor` after `npm ci`) prints your git branch, whether the containers match this checkout, the operator username the container is using, whether that user is in Mongo, and a login test against http://127.0.0.1:4173.

Change the password in a `.env` file before anyone else can open the site:

| Field    | Local default              |
|----------|----------------------------|
| Username | `operator`                 |
| Email    | `operator@example.com`     |
| Password | `operator-local-change-me` |

Sign in with the username or the email. The header shows **(operator)**. **Go live** uses the camera and microphone. **Operator controls** creates an OBS broadcast.

Change the password in a `.env` file before anyone else can open the site:

```sh
# .env
OPERATOR_PASSWORD=choose-a-long-password
```

Then `docker compose up --build -d` again. Auth updates the existing operator to that password. An old `.env` copied from an earlier example can set `WEB_HOSTS` to only `127.0.0.1,localhost`. Docker Compose ignores that for the page and allows every hostname, while the published port stays on `127.0.0.1`. A `MONGO_URI` in `.env` is used by `npm run dev` only. Compose always uses `mongodb://mongo:27017/buttblastr_auth`.

Login does not use a cookie. The page stores the token in memory and calls `/api/...` on the same origin, so a Cloudflare `https://` link does not depend on `Secure` cookies. Chat uses `wss://` on that same host.

Anyone else uses **Create account**. That signup is a normal viewer. It can chat and create a browser stream key. It cannot open **Operator controls**.

## Try it in the browser

1. Open http://127.0.0.1:4173.
2. Sign in as `operator` with the password above, or open **Create account** and make a new viewer. Usernames are 3–32 letters, numbers, `.`, `_`, or `-`. Passwords are at least 8 characters.
3. The header should switch to "Signed in as …". Chat connects to the `lobby` room through `/ws` on the same address as the page.
4. Type a message and press **Send**. It shows up in the chat box. A second browser window signed in as another user, joined to `lobby`, receives it too. Refreshing the page reloads recent messages from Redis.
5. In **Go live**, enter a title and press **Allow camera and microphone**. The browser asks for the camera and the microphone. A preview appears on this computer only. Pick a camera or microphone if you have more than one, and use **Mute** or **Camera off** if you want.
6. Press **Start streaming**. The preview stays on your side, and the main player switches from the standby clips to your camera. Chat keeps working beside it. **Stop streaming** ends the broadcast and the player goes back to the clips.
7. Signed in as the operator, **Operator controls** and **Create broadcast** make an OBS stream. **Show OBS settings** shows the server `rtmp://` this computer's name `:1935` and a stream key. Start streaming in OBS and the same player switches to that broadcast.
8. **Record** is on for every new broadcast. Uncheck it before **Start streaming** or **Create broadcast** when that one should not be saved. While a browser broadcast is live, the same checkbox turns recording off or on. On an OBS broadcast, use **Stop recording** or **Record**.
9. After **Stop streaming** or **End broadcast**, the saved broadcast appears under **Past streams** with its title, date, and length. Click it to play it in the same player. **Delete** removes your own recording.
10. While you are signed in and a live broadcast is playing, **Clip last 30s** and **Clip last 60s** save the newest part of that recording. On a past stream, set **Start** and **End** (60 seconds at most) and press **Make clip**. The new item shows up under **Clips**. Its link, `/clip/` followed by the id, plays for anyone, including someone who is not signed in and someone who opened the tunnel link.

Until someone is actually publishing, the player shuffles six short animal clips and does not play the same one twice in a row. They stay muted. Each clip plays for about 9 seconds, or until it ends if that is sooner, and then the next one starts. **Next clip** skips ahead. A live stream, a past recording, or a shared clip stops that timer so it cannot cut into the real video. Coming back to standby starts the shuffle again. A created broadcast stays off the public list until the camera, OBS, or another encoder connects. Each account can have one browser broadcast; stop it before starting another. Recordings stay in `media/recordings/` and clips stay in `media/clips/` on this computer. `docker compose up` keeps them. A normal restart does not delete them.

If the browser never asks for the camera, or it says permission was denied: on a Mac open **System Settings > Privacy & Security > Camera** and **Microphone**, allow Safari or Chrome, then click **Allow camera and microphone** again.

## Standby clips

These files live in `media/standby/` and are served from `/standby/`. Each one is a short excerpt. The sources are public domain or [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

| Clip | File | Author | License | Source |
|------|------|--------|---------|--------|
| Hamsters on a wheel | `hamsters.mp4` | Anna Frodesiak | CC0 | [Dwarf hamsters running on disc](https://commons.wikimedia.org/wiki/File:Dwarf_hamsters_running_on_disc.ogv) |
| Kitten jumping on a mat | `kitten.mp4` | Fumikas Sagisavas | CC0 | [Kitten jumping on bamboo mat](https://commons.wikimedia.org/wiki/File:Kitten_jumping_on_bamboo_mat.webm) |
| Otter scrubbing up | `otter.mp4` | Uusijani | CC0 | [Otter scrubbing up at Artis](https://commons.wikimedia.org/wiki/File:Otter_scrubbing_up_at_Artis.ogv) |
| Chinstrap penguin | `penguin.mp4` | Aunuki | Public domain | [Chinstrap Penguin](https://commons.wikimedia.org/wiki/File:Chinstrap_Penguin.ogv) |
| Mr Kitty | `kitty.mp4` | PseudoSkull | CC0 | [My Cat "Mr Kitty" or "Jellybelly"](https://commons.wikimedia.org/wiki/File:My_Cat_%22Mr_Kitty%22_or_%22Jellybelly%22.webm) |
| Dogs in the grass | `dogs.mp4` | Umngeni | CC0 | [Africanis Dogs Resting In Grass](https://commons.wikimedia.org/wiki/File:Africanis_Dogs_Resting_In_Grass.ogv) |

When a broadcast stops, ffmpeg joins every recorded piece in that folder, in order, into `media/recordings/<stream id>/final.mp4`. A pause in the middle stays in the file instead of cutting it off. The video stays H264. Opus from a browser broadcast is converted to AAC, and AAC from OBS is kept. The file is a normal progressive MP4 with the index at the front, so Safari, Chrome, and Firefox can seek it. The page loads it from `/recordings/<stream id>/final.mp4` on port 4173, including through the tunnel. A clip is the same kind of file at `/clips/<id>.mp4`. A byte-range request gets a 206 response. Live viewers on the tunnel still watch the broadcast over HLS, which is a few seconds behind. On this computer the live player uses WebRTC and is usually under a second.

The folder `frontend/` is an optional Next.js HLS player for later. It is not started by `docker compose up`. To look at it: `cd frontend && npm ci && npm run dev`, then open http://127.0.0.1:3000. Install `hls.js` in that folder before using `/player`.

## Check from the terminal

With the stack running and Node 20+ installed:

```sh
node scripts/check.js
```

Or `npm run check` after `npm ci`. The script registers a user, logs in, checks that a stream stays offline until an encoder connects, checks publish auth, turns recording off and on, publishes a short test pattern over RTMP, reads the HLS playlist through port 4173, saves a live clip and the recording, plays that recording, saves a clip from it, deletes the recording, exchanges chat messages, saves a content item, and loads the page.

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

`local/media.compose.yml` is an older separate MediaMTX project. Do not start it beside this stack. It uses the same RTMP and WebRTC ports. If a container named `pulseplay-media-media-1` is still around, remove it with `docker rm -f pulseplay-media-media-1` and run `docker compose up --build -d` again.

## How the pieces connect

```text
Browser  http://127.0.0.1:4173   (or https://your.domain)
   |-- /api/auth/*       -> Auth (MongoDB) -> JWT
   |-- /api/stream*      -> Streams (Postgres)
   |-- /api/content/*    -> Content (MongoDB)
   |-- /ws               -> Chat (Redis history)
   |-- /{id}/whip        -> MediaMTX WebRTC (browser publish)
   |-- /{id}/whep        -> MediaMTX WebRTC (low-latency playback)
   |-- /{id}/index.m3u8  -> MediaMTX HLS (playback fallback)
   |-- /recordings/     -> finished past-stream MP4 files
   \-- /clips/          -> saved clip files

OBS  rtmp://127.0.0.1:1935/{id}?key=...  -> MediaMTX
Browser WebRTC media on this computer    -> UDP 127.0.0.1:8189
```

The page asks MediaMTX whether a path is actually publishing. Viewers see a stream only while that is true. MediaMTX asks the streams service before it accepts a publish or plays a recording. A browser broadcast accepts WebRTC only, and an OBS broadcast accepts RTMP only. Watching (WebRTC, HLS, a past stream, or a clip) does not need the stream key. MediaMTX writes each recorded broadcast as short fMP4 pieces under `media/recordings/`. When the broadcast stops, the streams service joins every piece into `final.mp4`, including pieces separated by a pause, and stores the title, owner, times, and length in Postgres. A finished file that is much shorter than those pieces is rebuilt the next time the streams service starts. ffmpeg cuts a clip from that joined file into `media/clips/`. Both files are served with byte ranges through port 4173.

## What a remote viewer gets

On this Mac, the player tries WebRTC first. That media uses UDP port 8189 on `127.0.0.1`, so a browser on the same computer usually connects in under a second. A Cloudflare quick tunnel only carries HTTPS. It does not carry that UDP, so a friend opening the `trycloudflare.com` link cannot complete WebRTC. The player waits about 12 seconds, then switches to HLS on the same HTTPS address by itself. Expect about 3–8 seconds of delay on that fallback. Chat is on the same page either way.

A VPS with a public IP can offer remote WebRTC too: publish `8189:8189/udp` (not only on `127.0.0.1`) and set `webrtcAdditionalHosts` in `local/mediamtx.yml` to that public IP. The default setup does not do that, so remote viewers use HLS.

## Share a link from your Mac

The page, the APIs, and chat all use port **4173**. A tunnel only has to forward that one port. This works only while your Mac is on and the stack is running. Change `OPERATOR_PASSWORD` in `.env` and run `docker compose up -d` before you send the link to anyone.

```sh
brew install cloudflared
docker compose up -d
cloudflared tunnel --url http://127.0.0.1:4173
```

Cloudflare prints an `https://….trycloudflare.com` address. Open that. Create account, sign in, chat, and watching all work there. A friend sees the standby clips until you press **Start streaming** on the Mac, then the live picture over HLS (a few seconds behind you). Stopping the stream sends them back to the clips. WebRTC from their browser back to your Mac usually does not cross this tunnel, and the page falls back to HLS on its own. Stop the tunnel with Ctrl+C. The link dies when you do.

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
- **Go live says you already have a browser broadcast.** Press **Stop streaming** or **End** on the existing one, then start another.
- **The camera or microphone prompt never appears, or the page says permission was denied.** On a Mac open System Settings > Privacy & Security > Camera and Microphone, allow Safari or Chrome, then click **Allow camera and microphone** again.
- **The player says the standby clips are unavailable.** The clips are part of the repo under `media/standby/`. Rebuild with `docker compose up --build -d` so the image contains them.
- **docker compose up says port 1935 or 8189 is already allocated.** An older MediaMTX container is still running. `docker rm -f pulseplay-media-media-1` then `docker compose up --build -d`. `bash scripts/doctor.sh` reports that container when it sees it.
- **A remote viewer stays on the standby clips while you are live.** Give the list a couple of seconds. The player polls every 2 seconds. If the HLS address fails, the player returns to the clips after about 20 seconds.
- **Operator login fails.** Run `bash scripts/doctor.sh`. It is the thing to trust. The usual cause is still being on `main`, or running `docker compose up -d` without `--build`. Sign in as `operator` / `operator-local-change-me` unless your `.env` sets `OPERATOR_PASSWORD`. You do not need `docker compose down -v`. Auth logs say `no such user` or `wrong password`.
- **Port 4173 already in use.** Stop the other copy of this app. An old process from `~/.copilot` has done that before.
