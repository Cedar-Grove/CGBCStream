import { disableDestination, enableDestinationWithUrl, enableDestination } from "../destinations/service.js";
import { getDestinationMeta } from "../destinations/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { createAndStartBroadcast } from "../youtube/youtubeService.js";
import { nextOccurrenceWindow } from "./occurrence.js";
import { listActiveSchedules } from "./repository.js";
import type { SchedulePublic } from "./types.js";

const LEAD_MINUTES = 10;
const TICK_MS = 30_000; // twice a minute so we don't miss the exact start/end minute

interface OccurrenceState {
  windowStartIso: string;
  prepared: boolean;
  started: boolean;
  stopped: boolean;
  preparedRtmpUrls: Map<string, string>;
}

/**
 * Ticks every 30s. For each active schedule's current/next occurrence:
 *  - at lead time, pre-creates any YouTube broadcasts (so the channel
 *    doesn't go live on YouTube's auto-start until the actual push
 *    begins at the real start time — the broadcast is just reserved
 *    early, not fed video yet)
 *  - at start time, enables all configured destinations
 *  - at end time, disables them (YouTube's own auto-stop then completes
 *    the broadcast once it sees the feed stop)
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
      state = { windowStartIso, prepared: false, started: false, stopped: false, preparedRtmpUrls: new Map() };
      this.occurrenceState.set(schedule.id, state);
    }

    const leadTime = new Date(window.start.getTime() - LEAD_MINUTES * 60_000);

    if (schedule.autoCreateYoutube && !state.prepared && now >= leadTime && now < window.start) {
      state.prepared = true;
      await this.prepareYoutubeBroadcasts(schedule, window.start, state);
    }

    if (!state.started && now >= window.start && now < window.end) {
      state.started = true;
      await this.startDestinations(schedule, state);
    }

    if (!state.stopped && now >= window.end) {
      state.stopped = true;
      for (const destinationId of schedule.destinationIds) {
        disableDestination(this.relayManager, destinationId);
      }
    }
  }

  private async prepareYoutubeBroadcasts(
    schedule: SchedulePublic,
    scheduledStart: Date,
    state: OccurrenceState,
  ): Promise<void> {
    for (const destinationId of schedule.destinationIds) {
      const meta = getDestinationMeta(destinationId);
      if (meta?.platform !== "youtube" || !meta.youtubeAccountId) continue;
      const refreshToken = getRefreshToken(meta.youtubeAccountId);
      if (!refreshToken) {
        console.error(`[scheduler] YouTube account for destination ${destinationId} no longer exists`);
        continue;
      }
      try {
        const { rtmpUrl } = await createAndStartBroadcast(refreshToken, schedule.title, scheduledStart);
        state.preparedRtmpUrls.set(destinationId, rtmpUrl);
      } catch (err) {
        console.error(`[scheduler] failed to pre-create YouTube broadcast for ${destinationId}:`, err);
      }
    }
  }

  private async startDestinations(schedule: SchedulePublic, state: OccurrenceState): Promise<void> {
    for (const destinationId of schedule.destinationIds) {
      const preparedUrl = state.preparedRtmpUrls.get(destinationId);
      if (preparedUrl) {
        enableDestinationWithUrl(this.relayManager, destinationId, preparedUrl);
        continue;
      }
      const result = await enableDestination(this.relayManager, destinationId, schedule.title);
      if (!result.ok) {
        console.error(`[scheduler] failed to enable destination ${destinationId}: ${result.error}`);
      }
    }
  }
}
