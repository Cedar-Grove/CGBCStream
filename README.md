# CGBCStream

Ingests the program feed from a Blackmagic Web Presenter and relays it
live to YouTube, Subsplash, and (future) Facebook. See
[PROJECT_PLAN.md](./PROJECT_PLAN.md) for the full architecture and
build-phase breakdown.

All planned phases (1–6) are done: the ingest→relay pipeline,
configurable destinations with a web UI, a live input preview, YouTube
OAuth + broadcast creation, a scheduler, and Google-login-gated access
with stream session history. Facebook is stubbed as a future adapter,
same pattern as the other platforms.

## Running it

```sh
cp .env.example .env
# edit .env: set ENCRYPTION_KEY (encrypts stream keys/refresh tokens at
# rest) and MEDIAMTX_API_PASSWORD (any random string — shared secret so
# the backend can query MediaMTX's control API for input status/preview)
# — see "Login setup" below for the Google OAuth vars

docker compose up --build
```

Open `http://<this-machine-ip>:3000` and click **Sign in with Google**
— only `cedargroveleeds.org` and `cedargroveleedsmedia.org` accounts are
accepted (see setup below). **The app will not let anyone in until the
`GOOGLE_LOGIN_*` vars are set**, so complete that setup before your
first `docker compose up`.

### Login setup (Google Workspace OAuth)

This is separate from the YouTube channel connection below — it's for
signing into CGBCStream itself.

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth
   client ID → Web application (you can reuse the same client you
   create for YouTube below — just add both redirect URIs to it).
2. Add an authorized redirect URI:
   `http://<this-machine-ip>:3000/api/auth/google/callback`
3. In `.env`, set `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`,
   `GOOGLE_LOGIN_REDIRECT_URI` (matching the URI above), and
   `ALLOWED_GOOGLE_DOMAINS` (defaults to
   `cedargroveleeds.org,cedargroveleedsmedia.org` in `.env.example`).
4. Restart (`docker compose up -d --build`).

Anyone signing in with a Google account outside those domains is
rejected after Google's consent screen (checked server-side against
the ID token's email and `hd` claim) — there's no way to bypass this
from the client.

- MediaMTX listens for the incoming RTMP push on port `1935`.
- The web UI + API is on port `3000`.

Point the Blackmagic Web Presenter's RTMP output at
`rtmp://<this-machine-ip>:1935/live`.

Then go to **Destinations**:
- **Subsplash / Facebook**: "+ Add destination" → name, server URL,
  stream key.
- **YouTube**: "Connect YouTube channel" (see setup below) — no manual
  RTMP details needed, a fresh key is created per broadcast.

Tick **In schedule** on the destinations you want scheduled streams to
use. That is configuration only — it never starts or stops anything. All
streaming is driven by **Schedule** entries (weekly recurring or one-off,
with a start time, duration, which destinations to use, and whether to
auto-create a YouTube broadcast); the scheduler is the only thing that
starts a relay, at the occurrence's start, and stops it at the end.
There is no ad-hoc "go live now" — an unscheduled service means adding a
one-off schedule entry for it.

Scheduled YouTube broadcasts are reserved at **local midnight on the day
of the service**, so the watch link exists hours beforehand and the
broadcast shows on the channel as upcoming. Reserving it doesn't start
it — YouTube's auto-start only fires once the relay actually pushes at
the scheduled time. Reservations are stored (encrypted, since the RTMP
url embeds the stream key) and keyed by schedule + destination +
occurrence, so two services on the same day each go to their own
broadcast, and a restart in between doesn't strand one or create a
duplicate. If reserving fails — expired YouTube auth, an API blip — it
retries every 5 minutes through the day, and failing that the broadcast
is created at start time as before.

Times are the container's local time. `docker-compose.yml` sets
`TZ=America/Chicago`; override it by setting `TZ` in `.env`. This applies
to schedule start times generally, not just the midnight reservation. The **Dashboard** shows the incoming feed and live status per
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
   account. At Google's account chooser, pick the account that owns the
   channel — if it manages several, the one you pick is the channel that
   gets streamed to.

Channels are keyed by their YouTube channel id, so reconnecting one that
is already linked refreshes its credentials in place rather than adding a
second copy. The destinations list shows which channel each YouTube
destination pushes to and when it was linked. Deleting a YouTube
destination disconnects its channel, so no stored refresh token is left
behind with nothing referencing it.

Broadcasts are created with `enableAutoStart`/`enableAutoStop`, so
YouTube itself flips the broadcast live once it sees the relay's RTMP
data, and ends it once the feed stops — no manual "go live" step on
YouTube's side. They are titled after the schedule entry, go out
`public`, and are declared as English audio so YouTube generates English
automatic captions. When the scheduled window ends the broadcast is set
to **unlisted**, so it drops out of the channel's listings but stays
watchable by anyone with the link.

Note: a backend restart mid-service recovers on its own. The scheduler's
next tick sees it is still inside the occurrence window and resumes
relaying, reusing the broadcast reserved at midnight rather than creating
another.

## Testing without the Web Presenter

Simulate the encoder with ffmpeg's test source, pointed at the same
ingest path:

```sh
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000" \
  -c:v libx264 -preset veryfast -c:a aac \
  -f flv rtmp://localhost:1935/live
```

Then add/connect a destination, tick **In schedule** on it, and add a
one-off Schedule entry starting a minute or two out — you should see the
test pattern appear at the destination shortly after the start time, and
in the Dashboard's preview player.

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
