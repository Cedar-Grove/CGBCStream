# CGBCStream

Ingests the program feed from a Blackmagic Web Presenter and relays it
live to YouTube, Subsplash, and (future) Facebook. See
[PROJECT_PLAN.md](./PROJECT_PLAN.md) for the full architecture and
build-phase breakdown.

Phases 1–2 are done: the ingest→relay pipeline, plus configurable
destinations (add/edit/enable/disable YouTube, Subsplash, or a future
Facebook adapter) with a web UI. Scheduler, YouTube broadcast
auto-creation, and the live input preview are not built yet.

## Running it

```sh
cp .env.example .env
# edit .env: set ENCRYPTION_KEY to a long random passphrase (used to
# encrypt destination stream keys at rest)

docker compose up --build
```

- MediaMTX listens for the incoming RTMP push on port `1935`.
- The web UI + API is on port `3000`.

Point the Blackmagic Web Presenter's RTMP output at
`rtmp://<this-machine-ip>:1935/live`.

Open `http://<this-machine-ip>:3000` → **Destinations** → add a
destination (name, platform, server URL, stream key), then click
**Enable** to start relaying to it. The **Dashboard** shows live
status per destination.

## Testing without the Web Presenter

Simulate the encoder with ffmpeg's test source, pointed at the same
ingest path:

```sh
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000" \
  -c:v libx264 -preset veryfast -c:a aac \
  -f flv rtmp://localhost:1935/live
```

Then add a destination in the UI (or via API) and click Enable — you
should see the test pattern appear at the destination within a few
seconds.

## Backend dev (without Docker)

```sh
cd backend
npm install
ENCRYPTION_KEY=dev-only npm run dev
```

Requires `ffmpeg` on PATH and a reachable `SOURCE_RTMP_URL` (e.g. point
it at `rtmp://localhost:1935/live` if MediaMTX is running via
`docker compose up mediamtx`). The API is served without the built
frontend in this mode; run the frontend separately for UI dev:

```sh
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:3000` (see `frontend/vite.config.ts`).
