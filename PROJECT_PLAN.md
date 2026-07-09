# CGBCStream — Project Plan

## Purpose

CGBCStream ingests the single program feed produced by a Blackmagic Web
Presenter and relays it live to one or more configurable streaming
destinations (YouTube, Subsplash today; Facebook planned). It also
auto-creates YouTube live broadcasts on a recurring schedule (e.g. Sunday
service times) so no one has to manually create a YouTube livestream
before each service.

## Decisions locked in

- **Runs on-prem**, on a small always-on box on the same network as the
  Web Presenter (mini-PC / NUC). Avoids depending on venue upload
  bandwidth to reach a cloud relay and keeps latency low.
- **Fan-out is self-hosted via ffmpeg** — no third-party restream SaaS.
- **Subsplash is treated as a static RTMP destination**: one fixed
  ingest URL + stream key, configured once and left "on" — no API calls
  needed to start/stop a Subsplash broadcast, we just push to it whenever
  the destination is enabled.
- **YouTube is the only platform with scheduled auto-creation** in v1,
  since it requires a new `liveBroadcast`/`liveStream` per service via
  the YouTube Data API v3. Subsplash/Facebook destinations are toggled on
  when the schedule window starts, not "created."

## Architecture

```
Blackmagic Web Presenter
        │ RTMP/SRT push
        ▼
   MediaMTX (ingest server, local)
        │ pulled by ffmpeg (one process per destination, -c copy)
        ├──► YouTube RTMP ingest  (stream key created dynamically per broadcast)
        ├──► Subsplash RTMP ingest (fixed URL + key)
        └──► (future) Facebook Live RTMP ingest
        │
        └──► low-bitrate HLS/snapshot for UI preview
```

**Backend** (Node.js + TypeScript, Fastify):
- `DestinationManager` — CRUD for destinations behind a common
  `platform` interface (`youtube`, `subsplash`, later `facebook`), so
  adding Facebook is a new adapter, not a rewrite.
- `RelayController` — spawns/monitors one ffmpeg push process per enabled
  destination, restarts on crash, reports status (running/stopped/error,
  uptime, bitrate).
- `YouTubeService` — OAuth2 (stored refresh token), creates + binds
  `liveBroadcasts`/`liveStreams`, transitions broadcast lifecycle, used
  both for manual "go live" and scheduled auto-creation.
- `Scheduler` — recurring/one-off schedule entries; ahead of each
  scheduled start it creates the YouTube broadcast via `YouTubeService`
  and at start time enables the configured relay destinations; stops them
  at the scheduled end (or on manual stop).
- `StatusMonitor` — polls MediaMTX for input presence/resolution/bitrate
  and ffmpeg process health, pushes updates over WebSocket.
- SQLite (Prisma) for destinations, schedules, and stream session
  history/logs.
- Session-based auth (small number of admin accounts — this controls
  live broadcast infrastructure, not public-facing).

**Frontend** (React + TypeScript, Vite):
- **Dashboard** — live input preview (what the Web Presenter is currently
  sending) + a status card per destination (Live/Off/Error, uptime).
  Manual "Go Live Now" / "Stop" for ad-hoc streams.
- **Destinations** — add/edit/enable/disable destinations; form fields
  adapt to platform type (YouTube = OAuth-connected account; Subsplash /
  Facebook = RTMP URL + stream key).
- **Schedule** — recurring and one-off entries (day/time/duration/title),
  per-entry "auto-create YouTube broadcast" toggle (on by default),
  which destinations to bring up automatically.

**Deployment**: Docker Compose on the on-prem box — `mediamtx` container
for ingest, `cgbcstream-app` container (backend + built frontend, ffmpeg
installed) for everything else. `restart: always`; on restart the
backend reconciles actual ffmpeg/YouTube state against the DB so a reboot
mid-service self-heals.

## Data model (initial)

- `destinations`: id, name, platform, rtmp_url, stream_key (encrypted),
  enabled, created_at
- `schedules`: id, title, recurrence (day-of-week + time, or one-off
  datetime), duration_minutes, auto_create_youtube, destination_ids,
  active
- `stream_sessions`: id, schedule_id (nullable), started_at, ended_at,
  youtube_broadcast_id, destinations_used, status

## Build phases

1. **Pipeline spike** — MediaMTX + one hardcoded ffmpeg push, prove
   Web Presenter → relay → single destination works end-to-end.
2. **Destinations** — CRUD, generic multi-destination `RelayController`,
   Destinations UI.
3. **Status & preview** — input detection, per-destination health,
   dashboard preview.
4. **YouTube integration** — OAuth flow, broadcast creation/lifecycle via
   API, bind to relay, manual "go live."
5. **Scheduler** — recurring schedules, auto-create YouTube broadcast
   ahead of start, auto start/stop destinations, Schedule UI.
6. **Hardening** — crash recovery/reconciliation on restart, auth,
   session history/logs.
7. **Future** — Facebook Live adapter (same `platform` interface as
   YouTube/Subsplash).

## Open items to confirm before/at each phase

- Exact Web Presenter output: RTMP push vs. SRT — check the unit's
  firmware/config to set MediaMTX's ingest protocol accordingly.
- YouTube OAuth: needs a Google Cloud project + OAuth client credentials
  (channel must be enabled for live streaming).
- Subsplash RTMP URL + stream key for the church's channel (obtain from
  Subsplash Broadcaster settings).
