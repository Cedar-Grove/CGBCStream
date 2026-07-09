# CGBCStream — Project Plan

## Purpose

CGBCStream ingests the single program feed produced by a Blackmagic Web
Presenter and relays it live to one or more configurable streaming
destinations (YouTube, Subsplash today; Facebook planned). It also
auto-creates YouTube live broadcasts on a recurring schedule (e.g. Sunday
service times) so no one has to manually create a YouTube livestream
before each service.

## Decisions locked in

- **Runs on-prem**, as a VM on the church's Proxmox host, on the same
  network/VLAN as the Web Presenter. Avoids depending on venue upload
  bandwidth to reach a cloud relay and keeps latency low. Since fan-out
  is `-c copy` (remux, not transcode), a modest VM (2 vCPU / 2GB RAM) is
  plenty — no need for a dedicated physical box or GPU passthrough.
- **Ingest protocol is RTMP** (Web Presenter supports both RTMP and SRT).
  SRT's main advantage — loss recovery/encryption over unreliable
  networks — doesn't matter on a stable local LAN, so RTMP keeps things
  simpler. MediaMTX supports SRT too, so switching later (e.g. if the
  encoder ever needs to reach the relay over the internet) is just a
  config/URL change, not an architecture change.
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
- SQLite (`better-sqlite3`, plain SQL — no ORM needed at this schema size)
  for destinations, schedules, and stream session history/logs. Stream
  keys are encrypted at rest (AES-256-GCM, key derived from an
  `ENCRYPTION_KEY` env passphrase) and the API never returns the
  plaintext key back to the frontend, only a masked preview.
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

**Deployment**: Docker Compose on a Proxmox VM — `mediamtx` container
for ingest, `cgbcstream-app` container (backend + built frontend, ffmpeg
installed) for everything else. `restart: always`; on restart the
backend reconciles actual ffmpeg/YouTube state against the DB so a reboot
mid-service self-heals. The VM needs a static IP/DHCP reservation on the
Web Presenter's VLAN so its configured RTMP target doesn't break.

## Data model (initial)

- `destinations`: id, name, platform, rtmp_url, stream_key (encrypted),
  enabled, created_at
- `schedules`: id, title, recurrence (day-of-week + time, or one-off
  datetime), duration_minutes, auto_create_youtube, destination_ids,
  active
- `stream_sessions`: id, schedule_id (nullable), started_at, ended_at,
  youtube_broadcast_id, destinations_used, status

## Build phases

1. ✅ **Pipeline spike** — MediaMTX + one hardcoded ffmpeg push, prove
   Web Presenter → relay → single destination works end-to-end.
2. ✅ **Destinations** — CRUD, generic multi-destination `RelayManager`,
   Destinations UI.
3. ✅ **Status & preview** — input detection, per-destination health,
   dashboard preview.
4. ✅ **YouTube integration** — OAuth flow, broadcast creation via API
   (enableAutoStart/enableAutoStop instead of manual transitions), bind
   to relay.
5. ✅ **Scheduler** — recurring/one-off schedules, pre-creates YouTube
   broadcasts 10 min ahead of start (without feeding video yet, so
   autoStart doesn't go live early), starts/stops configured
   destinations at the scheduled window, Schedule UI.
6. **Hardening** — crash recovery/reconciliation on restart, auth,
   session history/logs.
7. **Future** — Facebook Live adapter (same `platform` interface as
   YouTube/Subsplash).

## Open items to confirm before/at each phase

- YouTube OAuth: needs a Google Cloud project + OAuth client credentials
  (channel must be enabled for live streaming).
- Subsplash RTMP URL + stream key for the church's channel (obtain from
  Subsplash Broadcaster settings).
- Proxmox VM specs/IP allocation (2 vCPU / 2GB RAM is the starting
  estimate — revisit if more destinations are added later).
