import { endSession, startSession } from "../history/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import { createAndStartBroadcast } from "../youtube/youtubeService.js";
import { getDestinationMeta, getFullRtmpUrl, setEnabled } from "./repository.js";

export interface EnableResult {
  ok: boolean;
  broadcastId?: string;
  error?: string;
  /** HTTP status the API route should map this failure to. */
  status?: 400 | 404 | 502;
}

// Tracks the open stream_sessions row per destination so disable can
// close it out — one relay process per destination, so one open
// session per destination at a time is always correct.
const openSessions = new Map<string, string>();

/** Shared by the manual enable API route and the scheduler. */
export async function enableDestination(
  relayManager: RelayManager,
  id: string,
  broadcastTitle?: string,
  scheduleId?: string | null,
): Promise<EnableResult> {
  const meta = getDestinationMeta(id);
  if (!meta) return { ok: false, error: "not found", status: 404 };

  if (meta.platform === "youtube") {
    if (!meta.youtubeAccountId) {
      return { ok: false, error: "no YouTube account linked", status: 400 };
    }
    const refreshToken = getRefreshToken(meta.youtubeAccountId);
    if (!refreshToken) {
      return { ok: false, error: "linked YouTube account no longer exists", status: 400 };
    }
    try {
      const { rtmpUrl, broadcastId } = await createAndStartBroadcast(
        refreshToken,
        broadcastTitle ?? meta.name,
        new Date(),
      );
      setEnabled(id, true);
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
      return { ok: false, error: (err as Error).message, status: 502 };
    }
  }

  const rtmpUrl = getFullRtmpUrl(id);
  if (!rtmpUrl) return { ok: false, error: "not found", status: 404 };
  setEnabled(id, true);
  relayManager.start(id, rtmpUrl);
  openSessions.set(
    id,
    startSession({ destinationId: id, destinationName: meta.name, platform: meta.platform, scheduleId }),
  );
  return { ok: true };
}

/** Starts relaying using an RTMP url obtained separately (a YouTube broadcast pre-created ahead of a scheduled start). */
export function enableDestinationWithUrl(
  relayManager: RelayManager,
  id: string,
  rtmpUrl: string,
  scheduleId?: string | null,
  youtubeBroadcastId?: string | null,
): void {
  const meta = getDestinationMeta(id);
  setEnabled(id, true);
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

export function disableDestination(relayManager: RelayManager, id: string): boolean {
  const updated = setEnabled(id, false);
  if (!updated) return false;
  relayManager.stop(id);
  const sessionId = openSessions.get(id);
  if (sessionId) {
    endSession(sessionId, "completed");
    openSessions.delete(id);
  }
  return true;
}
