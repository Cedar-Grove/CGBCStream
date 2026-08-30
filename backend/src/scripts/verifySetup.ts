/**
 * Pre-service check. Reports whether this install is actually able to stream:
 * credentials present and still accepted by Google, a channel connected, and
 * schedules pointing at destinations that will really be used.
 *
 * Run it inside the container:
 *   docker compose exec app node dist/scripts/verifySetup.js
 *
 * Exit code is 1 if anything failed, so it can be wired to a cron/alert.
 */
import { db } from "../db.js";
import { listDestinations } from "../destinations/repository.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { nextOccurrenceWindow, startOfLocalDay } from "../schedule/occurrence.js";
import { listActiveSchedules } from "../schedule/repository.js";

interface AccountRow {
  id: string;
  channel_id: string | null;
  channel_title: string;
  created_at: string;
}

let failures = 0;
let warnings = 0;

const ok = (msg: string) => console.log(`  ok    ${msg}`);
const warn = (msg: string) => {
  warnings += 1;
  console.log(`  WARN  ${msg}`);
};
const fail = (msg: string) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const section = (title: string) => console.log(`\n${title}`);

function localTime(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Exchanges the refresh token for an access token — the only real proof the authorisation still works. */
async function checkToken(accountId: string): Promise<{ alive: boolean; detail: string }> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { alive: false, detail: "client id/secret not configured" };

  const refreshToken = getRefreshToken(accountId);
  if (!refreshToken) return { alive: false, detail: "no stored refresh token" };

  let res: Response;
  let body: { error?: string; error_description?: string };
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    body = (await res.json()) as { error?: string; error_description?: string };
  } catch (err) {
    // Could not reach Google at all — that says nothing about the token, so
    // don't report it as dead.
    return { alive: false, detail: `could not reach Google: ${(err as Error).message}` };
  }
  if (res.ok) return { alive: true, detail: "Google issued a fresh access token" };
  if (body.error === "invalid_grant") {
    return { alive: false, detail: "invalid_grant — the authorisation is gone, reconnect the channel" };
  }
  return { alive: false, detail: `${body.error ?? res.status}: ${body.error_description ?? ""}`.trim() };
}

async function main(): Promise<void> {
  section("Environment");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`        timezone ${tz}, local time now ${localTime(new Date())}`);
  if (tz === "UTC") {
    warn("container is UTC — schedule times are read as UTC. Set TZ in docker-compose/.env.");
  } else {
    ok(`schedule times are interpreted as ${tz}`);
  }

  for (const name of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REDIRECT_URI", "ENCRYPTION_KEY"]) {
    if (process.env[name]) ok(`${name} is set`);
    else fail(`${name} is not set`);
  }

  section("Connected YouTube channels");
  const accounts = db
    .prepare("SELECT id, channel_id, channel_title, created_at FROM youtube_accounts ORDER BY created_at")
    .all() as AccountRow[];

  if (accounts.length === 0) {
    fail("no YouTube channel connected — use Connect YouTube channel");
  }
  for (const account of accounts) {
    console.log(`        ${account.channel_title}  linked ${localTime(new Date(account.created_at))}`);
    if (!account.channel_id) {
      warn(`${account.channel_title}: linked before channel ids were recorded — reconnect to de-duplicate it`);
    }
    const result = await checkToken(account.id);
    if (result.alive) ok(`${account.channel_title}: ${result.detail}`);
    else fail(`${account.channel_title}: ${result.detail}`);
  }

  section("Destinations");
  const destinations = listDestinations();
  if (destinations.length === 0) fail("no destinations configured");
  for (const destination of destinations) {
    const flag = destination.enabled ? "in schedule" : "NOT in schedule";
    if (destination.platform === "youtube") {
      if (!destination.youtubeAccountId || !destination.youtubeChannelTitle) {
        fail(`${destination.name}: no connected channel linked — it cannot stream`);
      } else {
        ok(`${destination.name} → ${destination.youtubeChannelTitle} (${flag})`);
      }
    } else if (!destination.hasStreamKey) {
      fail(`${destination.name}: no stream key set`);
    } else {
      ok(`${destination.name} (${destination.platform}, ${flag})`);
    }
  }

  const referenced = new Set(
    destinations.filter((d) => d.platform === "youtube").map((d) => d.youtubeAccountId),
  );
  for (const account of accounts) {
    if (!referenced.has(account.id)) {
      warn(`${account.channel_title} (linked ${localTime(new Date(account.created_at))}) has no destination — orphaned credentials`);
    }
  }

  section("Schedules");
  const schedules = listActiveSchedules();
  if (schedules.length === 0) warn("no active schedules — nothing will stream on its own");

  const byId = new Map(destinations.map((d) => [d.id, d]));
  const now = new Date();
  for (const schedule of schedules) {
    const window = nextOccurrenceWindow(schedule, now);
    console.log(`\n        “${schedule.title}”`);
    if (!window) {
      warn(`${schedule.title}: has no future occurrence`);
      continue;
    }
    console.log(`        next ${localTime(window.start)} → ${localTime(window.end)}`);
    if (schedule.autoCreateYoutube) {
      const reserveAt = startOfLocalDay(window.start);
      console.log(`        YouTube broadcast reserved from ${localTime(reserveAt)}`);
    }

    if (schedule.destinationIds.length === 0) {
      fail(`${schedule.title}: no destinations selected`);
      continue;
    }

    let willStream = 0;
    let includesYoutube = false;
    for (const id of schedule.destinationIds) {
      const destination = byId.get(id);
      if (!destination) {
        fail(`${schedule.title}: references destination ${id}, which no longer exists`);
        continue;
      }
      if (destination.platform === "youtube") includesYoutube = true;
      if (!destination.enabled) {
        fail(`${schedule.title}: ${destination.name} is selected but NOT ticked "in schedule" — it will be skipped`);
        continue;
      }
      ok(`${schedule.title}: will stream to ${destination.name}`);
      willStream += 1;
    }
    if (willStream === 0) fail(`${schedule.title}: nothing will stream`);
    if (includesYoutube && !schedule.autoCreateYoutube) {
      warn(`${schedule.title}: includes a YouTube destination but auto-create is off`);
    }
  }

  section("Summary");
  if (failures === 0 && warnings === 0) console.log("  Everything checks out.");
  else console.log(`  ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-setup crashed:", err);
  process.exit(1);
});
