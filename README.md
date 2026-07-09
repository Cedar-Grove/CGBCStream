# CGBCStream

Ingests the program feed from a Blackmagic Web Presenter and relays it
live to YouTube, Subsplash, and (future) Facebook. See
[PROJECT_PLAN.md](./PROJECT_PLAN.md) for the full architecture and
build-phase breakdown.

This is **phase 1**: a pipeline spike proving Web Presenter → MediaMTX →
ffmpeg → one destination works end-to-end. There's no UI, scheduler, or
YouTube integration yet — just `/relay/start`, `/relay/stop`,
`/relay/status` against a single hardcoded destination.

## Running it

```sh
cp .env.example .env
# edit .env: set DEST_RTMP_URL to a real destination (a YouTube "stream
# now" ingest URL+key, or the Subsplash Broadcaster RTMP URL+key)

docker compose up --build
```

- MediaMTX listens for the incoming RTMP push on port `1935`.
- The backend API listens on port `3000`.

Point the Blackmagic Web Presenter's RTMP output at
`rtmp://<this-machine-ip>:1935/live`.

## Testing without the Web Presenter

Simulate the encoder with ffmpeg's test source, pointed at the same
ingest path:

```sh
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000" \
  -c:v libx264 -preset veryfast -c:a aac \
  -f flv rtmp://localhost:1935/live
```

Then drive the relay:

```sh
curl -X POST http://localhost:3000/relay/start
curl http://localhost:3000/relay/status
curl -X POST http://localhost:3000/relay/stop
```

If `DEST_RTMP_URL` is a YouTube "stream now" key, you should see the test
pattern appear in YouTube Studio's live preview within a few seconds of
`/relay/start`.

## Backend dev (without Docker)

```sh
cd backend
npm install
npm run dev
```

Requires `ffmpeg` on PATH and a reachable `SOURCE_RTMP_URL` (e.g. point
it at `rtmp://localhost:1935/live` if MediaMTX is running via
`docker compose up mediamtx`).
