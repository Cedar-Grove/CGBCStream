# CGBCStream

Ingests the program feed from a Blackmagic Web Presenter and relays it
live to YouTube, Subsplash, and (future) Facebook. See
[PROJECT_PLAN.md](./PROJECT_PLAN.md) for the full architecture and
build-phase breakdown.

All planned phases (1–6) are done: the ingest→relay pipeline,
configurable destinations with a web UI, a live input preview, YouTube
OAuth + broadcast creation, a scheduler, and basic login-gated access
with stream session history. Facebook is stubbed as a future adapter,
same pattern as the other platforms.

## Running it

```sh
cp .env.example .env
# edit .env: set ENCRYPTION_KEY (encrypts stream keys/refresh tokens at
# rest) and ADMIN_PASSWORD (gates the whole UI/API) to long random values

docker compose up --build
```

Open `http://<this-machine-ip>:3000` and sign in with `ADMIN_PASSWORD`
— there's one shared password for all operators, no individual
accounts. **The app will not let anyone in until `ADMIN_PASSWORD` is
set**, so set it before your first `docker compose up`.

- MediaMTX listens for the incoming RTMP push on port `1935`.
- The web UI + API is on port `3000`.

Point the Blackmagic Web Presenter's RTMP output at
`rtmp://<this-machine-ip>:1935/live`.

Then go to **Destinations**:
- **Subsplash / Facebook**: "+ Add destination" → name, server URL,
  stream key.
- **YouTube**: "Connect YouTube channel" (see setup below) — no manual
  RTMP details needed, a fresh key is created per broadcast.

Click **Enable** to go live to a destination manually, or set up
**Schedule** entries (weekly recurring or one-off, with a start time,
duration, which destinations to use, and whether to auto-create a
YouTube broadcast) so services go live automatically without touching
the UI. The **Dashboard** shows the incoming feed and live status per
destination, and **History** logs every stream session (manual or
scheduled) with start/end time and duration.

### YouTube setup

YouTube broadcast creation needs an OAuth client from a Google Cloud
project:

1. Google Cloud Console → enable the **YouTube Data API v3**.
2. APIs & Services → Credentials → Create OAuth client ID → Web
   application.
3. Add an authorized redirect URI:
   `http://<this-machine-ip>:3000/api/youtube/oauth/callback`
4. In `.env`, set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and
   `YOUTUBE_REDIRECT_URI` (matching the URI above exactly).
5. Restart (`docker compose up -d --build`), then click **Connect
   YouTube channel** in the UI and sign in with the channel's Google
   account.

Broadcasts are created with `enableAutoStart`/`enableAutoStop`, so
YouTube itself flips the broadcast live once it sees the relay's RTMP
data, and ends it once the feed stops — no manual "go live" step on
YouTube's side. They default to `public` visibility.

Note: a backend restart clears any YouTube destination's "enabled"
state, since its RTMP key was tied to a broadcast that no longer
exists — you'll need to click Enable again after a restart. Static
destinations (Subsplash/Facebook) restart automatically.

## Testing without the Web Presenter

Simulate the encoder with ffmpeg's test source, pointed at the same
ingest path:

```sh
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000" \
  -c:v libx264 -preset veryfast -c:a aac \
  -f flv rtmp://localhost:1935/live
```

Then add/connect a destination in the UI and click Enable — you
should see the test pattern appear at the destination within a few
seconds, and in the Dashboard's preview player.

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
