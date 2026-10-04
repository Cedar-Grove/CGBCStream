import {
  closeStaleSessions,
  startDestination,
  startPreparedDestination,
  stopDestination,
} from "../destinations/service.js";
import { getDestinationMeta, setYoutubeStreamId } from "../destinations/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { ensureReusableStream, reserveBroadcast } from "../youtube/youtubeService.js";
import { nextOccurrenceWindow, startOfLocalDay } from "./occurrence.js";
import { deletePreparedBefore, getPrepared, savePrepared } from "./preparedRepository.js";
import { listActiveSchedules, listSchedules } from "./repository.js";
import type { SchedulePublic } from "./types.js";

const TICK_MS = 30_000; // twice a minute so we don't miss the exact start/end minute

// Preparing can fail (expired YouTube auth, API blip). Retry through the day
// rather than giving up on the first attempt, but not on every tick.
const PREPARE_RETRY_MS = 5 * 60_000;

// Prepared rows are only meaningful for their own occurrence; keep a couple of
// days so a post-mortem can still see what was reserved, then drop them.
const PREPARED_RETENTION_MS = 2 * 24 * 60 * 60_000;

/** Identifies one occurrence of one schedule — what owns a destination while it is streaming. */
function runKey(scheduleId: string, windowStartIso: string): string {
  return `${scheduleId}@${windowStartIso}`;
}

interface OccurrenceState {
  windowStartIso: string;
  lastPrepareAttempt: number | null;
  started: boolean;
}

/** An occurrence that has been started and not yet stopped. */
interface RunningOccurrence {
  scheduleId: string;
  windowStartIso: string;
  end: Date;
  destinationIds: string[];
}

/**
 * Ticks every 30s. For each active schedule's current/next occurrence:
 *  - from local midnight of the occurrence's day, pre-creates any YouTube
 *    broadcasts, so the watch link exists well before the service (the
 *    broadcast is reserved, not fed — YouTube's auto-start only fires once
 *    the push actually begins)
 *  - at start time, starts relaying to every destination on the schedule
 *    that is switched on
 *  - at end time, stops them, ends the YouTube broadcast, and unlists it
 *
 * This is the only thing that starts or stops a relay. A destination's
 * `enabled` flag is configuration -- whether scheduled runs use it -- and
 * toggling it in the UI has no immediate effect.
 *
 * Started occurrences are tracked separately from the schedule's
 * current/next window, and stopped from that record. The window can't be
 * used for it: nextOccurrenceWindow never returns a window that has already
 * ended — at the end of a weekly service it rolls straight on to next week —
 * so "is the window over?" is never true and the stop would never run.
 *
 * Prepared broadcasts are persisted rather than held in memory: the gap
 * between midnight and the service is long enough that a restart in between
 * is likely, and losing the reservation would strand a broadcast on the
 * channel and create a second one at start time.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private occurrenceState = new Map<string, OccurrenceState>();
  private running = new Map<string, RunningOccurrence>();

  constructor(private readonly relayManager: RelayManager) {}

  async start(): Promise<void> {
    // Anything the last process left "running" is stale; close it before
    // the first tick can start this occurrence's sessions afresh.
    try {
      await closeStaleSessions((scheduleId, startedAt) => {
        const schedule = listSchedules().find((s) => s.id === scheduleId);
        const window = schedule && nextOccurrenceWindow(schedule, startedAt);
        return window && window.start <= startedAt ? window.end : null;
      });
    } catch (err) {
      console.error("[scheduler] failed to close stale sessions:", err);
    }
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
    // Stops first, so a destination freed by one occurrence ending is free
    // for another starting on the same tick.
    for (const [key, occurrence] of this.running) {
      if (now < occurrence.end) continue;
      this.running.delete(key);
      await this.stopOccurrence(occurrence);
    }
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
      state = { windowStartIso, lastPrepareAttempt: null, started: false };
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
      this.running.set(runKey(schedule.id, windowStartIso), {
        scheduleId: schedule.id,
        windowStartIso,
        end: window.end,
        destinationIds: [...schedule.destinationIds],
      });
      await this.startDestinations(schedule, windowStartIso);
    }
  }

  private async stopOccurrence(occurrence: RunningOccurrence): Promise<void> {
    for (const destinationId of occurrence.destinationIds) {
      const prepared = getPrepared(occurrence.scheduleId, destinationId, occurrence.windowStartIso);
      await stopDestination(
        this.relayManager,
        destinationId,
        prepared?.broadcastId,
        runKey(occurrence.scheduleId, occurrence.windowStartIso),
      );
    }
    console.log(`[scheduler] stopped schedule ${occurrence.scheduleId} occurrence ${occurrence.windowStartIso}`);
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
        // Reserved unbound: binding claims the destination's one persistent
        // stream key, so it waits until start time. Resolving the key here
        // anyway means the push URL is known — and created once — well before
        // the service.
        const { broadcastId } = await reserveBroadcast(refreshToken, schedule.title, scheduledStart, {
          englishCaptions: meta.englishCaptions,
        });
        const { streamId, rtmpUrl } = await ensureReusableStream(refreshToken, meta.youtubeStreamId);
        if (streamId !== meta.youtubeStreamId) setYoutubeStreamId(destinationId, streamId);
        savePrepared(schedule.id, destinationId, windowStartIso, { broadcastId, rtmpUrl });
        console.log(
          `[scheduler] reserved YouTube broadcast ${broadcastId} for schedule ${schedule.id} at ${windowStartIso}`,
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
        const result = await startPreparedDestination(
          this.relayManager,
          destinationId,
          prepared,
          schedule.id,
          runKey(schedule.id, windowStartIso),
        );
        if (!result.ok) {
          console.error(
            `[scheduler] failed to start destination ${destinationId} on its reserved broadcast: ${result.error}`,
          );
        }
        continue;
      }
      const result = await startDestination(
        this.relayManager,
        destinationId,
        schedule.title,
        schedule.id,
        runKey(schedule.id, windowStartIso),
      );
      if (!result.ok) {
        console.error(`[scheduler] failed to start destination ${destinationId}: ${result.error}`);
      }
    }
  }
}
