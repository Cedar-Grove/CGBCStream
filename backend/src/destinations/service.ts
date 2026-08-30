import { endSession, startSession } from "../history/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { createAndStartBroadcast } from "../youtube/youtubeService.js";
import { getDestinationMeta, getFullRtmpUrl } from "./repository.js";

export interface StartResult {
  ok: boolean;
  broadcastId?: string;
  error?: string;
}

// Tracks the open stream_sessions row per destination so stopping can close
// it out — one relay process per destination, so one open session per
// destination at a time is always correct.
const openSessions = new Map<string, string>();

/**
 * Starts relaying to a destination. Only the scheduler calls this — a
 * destination's `enabled` flag is configuration ("include this in scheduled
 * runs"), not a live switch, so nothing in the API starts a relay.
 */
export async function startDestination(
  relayManager: RelayManager,
  id: string,
  broadcastTitle?: string,
  scheduleId?: string | null,
): Promise<StartResult> {
  const meta = getDestinationMeta(id);
  if (!meta) return { ok: false, error: "not found" };

  if (meta.platform === "youtube") {
    if (!meta.youtubeAccountId) return { ok: false, error: "no YouTube account linked" };
    const refreshToken = getRefreshToken(meta.youtubeAccountId);
    if (!refreshToken) return { ok: false, error: "linked YouTube account no longer exists" };
    try {
      const { rtmpUrl, broadcastId } = await createAndStartBroadcast(
        refreshToken,
        broadcastTitle ?? meta.name,
        new Date(),
      );
      relayManager.start(id, rtmpUrl);
      openSessions.set(
        id,
        startSession({
          destinationId: id,
          destinationName: meta.name,
          platform: meta.platform,
          scheduleId,
          youtubeBroadcastId: broadcastId,
        }),
      );
      return { ok: true, broadcastId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  const rtmpUrl = getFullRtmpUrl(id);
  if (!rtmpUrl) return { ok: false, error: "not found" };
  relayManager.start(id, rtmpUrl);
  openSessions.set(
    id,
    startSession({ destinationId: id, destinationName: meta.name, platform: meta.platform, scheduleId }),
  );
  return { ok: true };
}

/** Starts relaying using an RTMP url obtained separately (a YouTube broadcast reserved ahead of a scheduled start). */
export function startDestinationWithUrl(
  relayManager: RelayManager,
  id: string,
  rtmpUrl: string,
  scheduleId?: string | null,
  youtubeBroadcastId?: string | null,
): void {
  const meta = getDestinationMeta(id);
  relayManager.start(id, rtmpUrl);
  if (meta) {
    openSessions.set(
      id,
      startSession({
        destinationId: id,
        destinationName: meta.name,
        platform: meta.platform,
        scheduleId,
        youtubeBroadcastId,
      }),
    );
  }
}

/** Stops the relay and closes its history session. Leaves `enabled` alone — that is configuration, not run state. */
export function stopDestination(relayManager: RelayManager, id: string): void {
  relayManager.stop(id);
  const sessionId = openSessions.get(id);
  if (sessionId) {
    endSession(sessionId, "completed");
    openSessions.delete(id);
  }
}
