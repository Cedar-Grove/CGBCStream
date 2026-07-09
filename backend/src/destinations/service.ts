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

/** Shared by the manual enable API route and the scheduler. */
export async function enableDestination(
  relayManager: RelayManager,
  id: string,
  broadcastTitle?: string,
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
      return { ok: true, broadcastId };
    } catch (err) {
      return { ok: false, error: (err as Error).message, status: 502 };
    }
  }

  const rtmpUrl = getFullRtmpUrl(id);
  if (!rtmpUrl) return { ok: false, error: "not found", status: 404 };
  setEnabled(id, true);
  relayManager.start(id, rtmpUrl);
  return { ok: true };
}

/** Starts relaying to a destination using an RTMP url obtained separately (e.g. a YouTube broadcast pre-created ahead of a scheduled start). */
export function enableDestinationWithUrl(relayManager: RelayManager, id: string, rtmpUrl: string): void {
  setEnabled(id, true);
  relayManager.start(id, rtmpUrl);
}

export function disableDestination(relayManager: RelayManager, id: string): boolean {
  const updated = setEnabled(id, false);
  if (!updated) return false;
  relayManager.stop(id);
  return true;
}
