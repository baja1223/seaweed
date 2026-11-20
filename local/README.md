# PulsePlay local stream test

The core app, including MediaMTX, starts with `docker compose up --build` from the repository root. See the root README for **Go live**, the tunnel, and the operator password (`operator` / `operator-local-change-me` unless `.env` sets `OPERATOR_PASSWORD`). Do not also run `local/media.compose.yml`. That older file is a separate Compose project named `pulseplay-media` and it binds the same ports. If `pulseplay-media-media-1` is still running, stop it with `docker rm -f pulseplay-media-media-1` before `docker compose up`.

The steps further down that mention `node local/start.js` and `taha-operator` are the older standalone test. `taha-operator` is not the Compose operator.

Open [PulsePlay](http://127.0.0.1:4173/) on this Mac. Guests can watch. **Create account** registers a normal viewer. The Docker Compose operator is `operator` / `operator-local-change-me`, not `taha-operator`. `taha-operator` exists only after you run `node local/setup-operator.js` for the optional media test below, and its password is in `~/.pulseplay-local/operator.txt`. Keep that file and the OBS stream keys private.

## Broadcast from a browser

1. Sign in, enter a stream title, and press **Allow camera and microphone**.
2. Allow the browser prompt. On a Mac, System Settings > Privacy & Security > Camera and Microphone must allow Safari or Chrome.
3. Press **Start streaming**. Use **Stop streaming** to close the broadcast and release the camera and microphone.

A broadcast belongs to the account that created it. Other accounts can watch it. If you reload and a previous broadcast is still listed in your studio, use its End button before starting another.

## Inspect the activity log

Run `node local/audit.js` from the project directory. Each event contains a timestamp, an event type, an internal account ID and, for broadcast events, a stream ID. The journal records account creation, successful sign-ins, and stream creation and closure. It excludes passwords, email addresses, tokens, stream keys, and media. The encrypted journal and its key have private file permissions under `~/.pulseplay-local/`. Access to the machine's account grants access to both files.

## Broadcast with OBS

1. Sign in as the operator and select **Create broadcast**.
2. Open **Show OBS settings** on that broadcast. In OBS, use the Custom service and copy the server and stream key into the corresponding settings.
3. Start streaming in OBS and select the broadcast in PulsePlay. Allow several seconds for the HLS buffer. To stop the built-in test feed, select **End broadcast** on its card.

The site is available to browsers on this Mac via loopback. When no live broadcast is playable, PulsePlay rotates the short CC0 and public-domain clips shipped in `media/standby/`. See the root README for each source and license.

## Start the local services

With the existing MongoDB, PostgreSQL and Redis containers running, install the Node dependencies with `npm ci`. Run `node local/setup-operator.js` once to create the account and private runtime files. Then start MediaMTX and the app.

```sh
docker compose -p pulseplay-media -f local/media.compose.yml up -d
node local/start.js
```

The app launcher records its process IDs and logs in `~/.pulseplay-local/`. Stop a running instance before launching its replacement. The existing database containers are managed separately.

## Publish the test pattern

Run these commands only if the test pattern is offline. The encoder command stays inside the media container.

```sh
node local/test-feed.js
docker compose -p pulseplay-media -f local/media.compose.yml exec -T media \
  sh -c 'umask 077; cat > /tmp/pulseplay-encoder.url' < ~/.pulseplay-local/encoder.url
docker compose -p pulseplay-media -f local/media.compose.yml exec -d media \
  sh -c 'exec ffmpeg -nostdin -hide_banner -loglevel error -re -f lavfi \
  -i testsrc2=size=640x360:rate=24 -c:v libx264 -pix_fmt yuv420p -preset ultrafast \
  -tune zerolatency -g 24 -f flv "$(cat /tmp/pulseplay-encoder.url)" > /tmp/pulseplay-encoder.log 2>&1'
```
