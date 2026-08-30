import { startDestination, startDestinationWithUrl, stopDestination } from "../destinations/service.js";
import { getDestinationMeta } from "../destinations/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { createAndStartBroadcast } from "../youtube/youtubeService.js";
import { nextOccurrenceWindow, startOfLocalDay } from "./occurrence.js";
import { deletePreparedBefore, getPrepared, savePrepared } from "./preparedRepository.js";
import { listActiveSchedules } from "./repository.js";
import type { SchedulePublic } from "./types.js";

const TICK_MS = 30_000; // twice a minute so we don't miss the exact start/end minute

// Preparing can fail (expired YouTube auth, API blip). Retry through the day
// rather than giving up on the first attempt, but not on every tick.
const PREPARE_RETRY_MS = 5 * 60_000;

// Prepared rows are only meaningful for their own occurrence; keep a couple of
// days so a post-mortem can still see what was reserved, then drop them.
const PREPARED_RETENTION_MS = 2 * 24 * 60 * 60_000;

interface OccurrenceState {
  windowStartIso: string;
  lastPrepareAttempt: number | null;
  started: boolean;
  stopped: boolean;
}

/**
 * Ticks every 30s. For each active schedule's current/next occurrence:
 *  - from local midnight of the occurrence's day, pre-creates any YouTube
 *    broadcasts, so the watch link exists well before the service (the
 *    broadcast is reserved, not fed — YouTube's auto-start only fires once
 *    the push actually begins)
 *  - at start time, starts relaying to every destination on the schedule
 *    that is switched on
 *  - at end time, stops them, and unlists the YouTube broadcast (its own
 *    auto-stop completes it once it sees the feed stop)
 *
 * This is the only thing that starts or stops a relay. A destination's
 * `enabled` flag is configuration -- whether scheduled runs use it -- and
 * toggling it in the UI has no immediate effect.
 *
 * Prepared broadcasts are persisted rather than held in memory: the gap
 * between midnight and the service is long enough that a restart in between
 * is likely, and losing the reservation would strand a broadcast on the
 * channel and create a second one at start time.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private occurrenceState = new Map<string, OccurrenceState>();

  constructor(private readonly relayManager: RelayManager) {}

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error("[scheduler] tick failed:", err));
    }, TICK_MS);
    this.tick().catch((err) => console.error("[scheduler] tick failed:", err));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    deletePreparedBefore(new Date(now.getTime() - PREPARED_RETENTION_MS).toISOString());
    for (const schedule of listActiveSchedules()) {
      await this.processSchedule(schedule, now);
    }
  }

  private async processSchedule(schedule: SchedulePublic, now: Date): Promise<void> {
    const window = nextOccurrenceWindow(schedule, now);
    if (!window) return;

    const windowStartIso = window.start.toISOString();
    let state = this.occurrenceState.get(schedule.id);
    if (!state || state.windowStartIso !== windowStartIso) {
      state = { windowStartIso, lastPrepareAttempt: null, started: false, stopped: false };
      this.occurrenceState.set(schedule.id, state);
    }

    const prepareFrom = startOfLocalDay(window.start);

    if (schedule.autoCreateYoutube && now >= prepareFrom && now < window.start) {
      const due =
        state.lastPrepareAttempt === null ||
        now.getTime() - state.lastPrepareAttempt >= PREPARE_RETRY_MS;
      if (due) {
        state.lastPrepareAttempt = now.getTime();
        await this.prepareYoutubeBroadcasts(schedule, window.start, windowStartIso);
      }
    }

    if (!state.started && now >= window.start && now < window.end) {
      state.started = true;
      await this.startDestinations(schedule, windowStartIso);
    }

    if (!state.stopped && now >= window.end) {
      state.stopped = true;
      for (const destinationId of schedule.destinationIds) {
        const prepared = getPrepared(schedule.id, destinationId, windowStartIso);
        await stopDestination(this.relayManager, destinationId, prepared?.broadcastId);
      }
    }
  }

  private async prepareYoutubeBroadcasts(
    schedule: SchedulePublic,
    scheduledStart: Date,
    windowStartIso: string,
  ): Promise<void> {
    for (const destinationId of schedule.destinationIds) {
      if (getPrepared(schedule.id, destinationId, windowStartIso)) continue;

      const meta = getDestinationMeta(destinationId);
      if (!meta?.enabled) continue;
      if (meta.platform !== "youtube" || !meta.youtubeAccountId) continue;
      const refreshToken = getRefreshToken(meta.youtubeAccountId);
      if (!refreshToken) {
        console.error(`[scheduler] YouTube account for destination ${destinationId} no longer exists`);
        continue;
      }
      try {
        const prepared = await createAndStartBroadcast(refreshToken, schedule.title, scheduledStart);
        savePrepared(schedule.id, destinationId, windowStartIso, prepared);
        console.log(
          `[scheduler] reserved YouTube broadcast ${prepared.broadcastId} for schedule ${schedule.id} at ${windowStartIso}`,
        );
      } catch (err) {
        console.error(`[scheduler] failed to pre-create YouTube broadcast for ${destinationId}:`, err);
      }
    }
  }

  private async startDestinations(schedule: SchedulePublic, windowStartIso: string): Promise<void> {
    for (const destinationId of schedule.destinationIds) {
      // `enabled` is the destination's opt-in to scheduled streaming; a
      // destination listed on the schedule but switched off is skipped.
      if (!getDestinationMeta(destinationId)?.enabled) continue;

      const prepared = getPrepared(schedule.id, destinationId, windowStartIso);
      if (prepared) {
        startDestinationWithUrl(
          this.relayManager,
          destinationId,
          prepared.rtmpUrl,
          schedule.id,
          prepared.broadcastId,
        );
        continue;
      }
      const result = await startDestination(this.relayManager, destinationId, schedule.title, schedule.id);
      if (!result.ok) {
        console.error(`[scheduler] failed to start destination ${destinationId}: ${result.error}`);
      }
    }
  }
}
