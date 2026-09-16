import { endSession, startSession } from "../history/repository.js";
import type { RelayManager } from "../relay/relayManager.js";
import { getRefreshToken } from "../youtube/accountsRepository.js";
import {
  bindBroadcastToStream,
  ensureReusableStream,
  reserveBroadcast,
  unlistBroadcast,
} from "../youtube/youtubeService.js";
import { getDestinationMeta, getFullRtmpUrl, setYoutubeStreamId } from "./repository.js";
import type { DestinationMeta } from "./types.js";

export interface StartResult {
  ok: boolean;
  broadcastId?: string;
  error?: string;
}

// Tracks the open stream_sessions row per destination so stopping can close
// it out — one relay process per destination, so one open session per
// destination at a time is always correct.
const openSessions = new Map<string, string>();

// The YouTube broadcast currently being pushed to, per destination, so it can
// be unlisted once the occurrence ends.
const openBroadcasts = new Map<string, string>();

// Which occurrence currently owns each destination, as "<scheduleId>@<occurrence>".
// A destination's YouTube stream key is persistent now, and a persistent key
// can only carry one live broadcast at a time, so a second overlapping
// occurrence must be refused rather than allowed to collide with the first.
const activeRuns = new Map<string, string>();

/** The occurrence currently streaming to this destination, if any. */
export function getActiveRunKey(destinationId: string): string | undefined {
  return activeRuns.get(destinationId);
}

/**
 * Starts relaying to a destination. Only the scheduler calls this — a
 * destination's `enabled` flag is configuration ("include this in scheduled
 * runs"), not a live switch, so nothing in the API starts a relay.
 *
 * `runKey` identifies the occurrence asking to stream. A destination already
 * streaming for a different occurrence is refused: its YouTube stream key is
 * persistent, and one key cannot carry two live broadcasts.
 */
export async function startDestination(
  relayManager: RelayManager,
  id: string,
  broadcastTitle?: string,
  scheduleId?: string | null,
  runKey?: string,
): Promise<StartResult> {
  const meta = getDestinationMeta(id);
  if (!meta) return { ok: false, error: "not found" };

  const clash = overlapError(id, runKey);
  if (clash) return { ok: false, error: clash };

  if (meta.platform === "youtube") {
    if (!meta.youtubeAccountId) return { ok: false, error: "no YouTube account linked" };
    const refreshToken = getRefreshToken(meta.youtubeAccountId);
    if (!refreshToken) return { ok: false, error: "linked YouTube account no longer exists" };
    try {
      const title = broadcastTitle ?? meta.name;
      const { broadcastId } = await reserveBroadcast(refreshToken, title, new Date(), {
        englishCaptions: meta.englishCaptions,
      });
      const rtmpUrl = await bindToPersistentStream(refreshToken, id, meta, broadcastId, title);

      relayManager.start(id, rtmpUrl);
      openBroadcasts.set(id, broadcastId);
      markActive(id, runKey);
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
  try {
    // Throws if the stored server URL is a backup ingest — a destination saved
    // before that was validated, or edited straight in the database.
    relayManager.start(id, rtmpUrl);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  markActive(id, runKey);
  openSessions.set(
    id,
    startSession({ destinationId: id, destinationName: meta.name, platform: meta.platform, scheduleId }),
  );
  return { ok: true };
}

/**
 * Starts a destination on a broadcast reserved earlier in the day.
 *
 * The reservation deliberately left the broadcast unbound — binding is what
 * claims the destination's one persistent stream key, so it happens here, at
 * start time, when only one occurrence can be going live.
 */
export async function startPreparedDestination(
  relayManager: RelayManager,
  id: string,
  prepared: { broadcastId: string; rtmpUrl: string },
  scheduleId?: string | null,
  runKey?: string,
): Promise<StartResult> {
  const meta = getDestinationMeta(id);
  if (!meta) return { ok: false, error: "not found" };

  const clash = overlapError(id, runKey);
  if (clash) return { ok: false, error: clash };

  let rtmpUrl = prepared.rtmpUrl;
  if (meta.platform === "youtube") {
    if (!meta.youtubeAccountId) return { ok: false, error: "no YouTube account linked" };
    const refreshToken = getRefreshToken(meta.youtubeAccountId);
    if (!refreshToken) return { ok: false, error: "linked YouTube account no longer exists" };
    try {
      rtmpUrl = await bindToPersistentStream(refreshToken, id, meta, prepared.broadcastId, meta.name);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  try {
    relayManager.start(id, rtmpUrl);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  openBroadcasts.set(id, prepared.broadcastId);
  markActive(id, runKey);
  openSessions.set(
    id,
    startSession({
      destinationId: id,
      destinationName: meta.name,
      platform: meta.platform,
      scheduleId,
      youtubeBroadcastId: prepared.broadcastId,
    }),
  );
  return { ok: true, broadcastId: prepared.broadcastId };
}

/**
 * Resolves the destination's persistent stream — creating it on the first
 * service and reusing it from then on — and points the broadcast at it.
 * Returns the push URL, which stays the same week to week.
 */
async function bindToPersistentStream(
  refreshToken: string,
  id: string,
  meta: DestinationMeta,
  broadcastId: string,
  title: string,
): Promise<string> {
  const { streamId, rtmpUrl } = await ensureReusableStream(refreshToken, title, meta.youtubeStreamId);
  if (streamId !== meta.youtubeStreamId) setYoutubeStreamId(id, streamId);
  await bindBroadcastToStream(refreshToken, broadcastId, streamId);
  return rtmpUrl;
}

function overlapError(id: string, runKey?: string): string | undefined {
  const active = activeRuns.get(id);
  if (!active || !runKey || active === runKey) return undefined;
  return `already streaming for ${active} — a destination's persistent stream key cannot carry two broadcasts at once`;
}

function markActive(id: string, runKey?: string): void {
  if (runKey) activeRuns.set(id, runKey);
}

/**
 * Stops the relay, closes its history session, and — when the destination's
 * "unlist after" setting is on — drops the YouTube replay out of the
 * channel's listings. Leaves `enabled` alone: that is configuration, not run
 * state.
 *
 * `fallbackBroadcastId` covers a backend restart mid-occurrence, where the
 * in-memory record is gone but the scheduler still holds the reservation.
 *
 * `runKey` is the occurrence asking to stop. An occurrence that never got to
 * stream (it was refused as an overlap) must not tear down the one that did,
 * so a mismatch is a no-op.
 */
export async function stopDestination(
  relayManager: RelayManager,
  id: string,
  fallbackBroadcastId?: string | null,
  runKey?: string,
): Promise<void> {
  const active = activeRuns.get(id);
  if (active && runKey && active !== runKey) return;

  relayManager.stop(id);
  activeRuns.delete(id);
  const sessionId = openSessions.get(id);
  if (sessionId) {
    endSession(sessionId, "completed");
    openSessions.delete(id);
  }

  const broadcastId = openBroadcasts.get(id) ?? fallbackBroadcastId;
  openBroadcasts.delete(id);
  if (!broadcastId) return;

  const meta = getDestinationMeta(id);
  if (meta?.platform !== "youtube" || !meta.youtubeAccountId) return;
  if (!meta.unlistAfter) return;
  const refreshToken = getRefreshToken(meta.youtubeAccountId);
  if (!refreshToken) return;
  try {
    await unlistBroadcast(refreshToken, broadcastId);
  } catch (err) {
    console.error(`[destinations] failed to unlist broadcast ${broadcastId}:`, err);
  }
}
