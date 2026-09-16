import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { assertPrimaryIngest } from "../relay/ingestUrl.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube"];

function getOAuthClient(): OAuth2Client {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI must be set to connect a YouTube channel",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  return getOAuthClient().generateAuthUrl({
    access_type: "offline",
    // "consent" forces a refresh_token even on a re-connect; "select_account"
    // is what reliably surfaces Google's "choose a channel/brand account"
    // step for accounts that manage a channel they don't personally own —
    // without it, Google silently picks whichever channel was last active.
    prompt: "consent select_account",
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(
  code: string,
): Promise<{ channelId: string; channelTitle: string; refreshToken: string }> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token — revoke CGBCStream's prior access at " +
        "https://myaccount.google.com/permissions and try connecting again",
    );
  }
  client.setCredentials(tokens);

  const yt = google.youtube({ version: "v3", auth: client });
  const channels = await yt.channels.list({ part: ["snippet"], mine: true });
  const channel = channels.data.items?.[0];
  if (!channel?.id) {
    throw new Error(
      "That Google account does not manage a YouTube channel — pick the channel's account and try again",
    );
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? "YouTube channel",
    refreshToken: tokens.refresh_token,
  };
}

function clientForRefreshToken(refreshToken: string): OAuth2Client {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface BroadcastOptions {
  privacyStatus?: "public" | "unlisted" | "private";
  /**
   * The destination's reusable stream resource, if it already has one. Null
   * or an id YouTube no longer knows about means one is created and the new
   * id comes back in the result for the caller to store.
   */
  reuseStreamId?: string | null;
  /** Declare the broadcast's audio as English, which is what makes YouTube generate English automatic captions. */
  englishCaptions?: boolean;
}

export interface BroadcastResult {
  broadcastId: string;
  rtmpUrl: string;
  /** The reusable stream the broadcast is bound to — persist it so the next service reuses the same key. */
  streamId: string;
  /** Whether the English audio language was actually accepted (captions are best-effort, going live is not). */
  englishCaptionsSet: boolean;
}

/**
 * Creates the broadcast only — no stream, no binding.
 *
 * Kept separate because a reusable stream may be bound to just one broadcast
 * at a time. Broadcasts are reserved hours ahead (at local midnight), so
 * reserving two services on the same day would otherwise have the second
 * bind steal the stream from the first. Binding happens at start time
 * instead, when only one of them can actually be going live.
 */
export async function reserveBroadcast(
  refreshToken: string,
  title: string,
  scheduledStartTime: Date,
  options: BroadcastOptions = {},
): Promise<{ broadcastId: string; englishCaptionsSet: boolean }> {
  const yt = google.youtube({ version: "v3", auth: clientForRefreshToken(refreshToken) });

  const broadcast = await yt.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title,
        scheduledStartTime: scheduledStartTime.toISOString(),
      },
      status: { privacyStatus: options.privacyStatus ?? "public" },
      // enableAutoStart/enableAutoStop let YouTube transition the broadcast
      // live once it sees RTMP data, and end it once the feed stops — no
      // separate transition() calls needed on our side.
      contentDetails: { enableAutoStart: true, enableAutoStop: true },
    },
  });

  const broadcastId = broadcast.data.id;
  if (!broadcastId) throw new Error("YouTube did not return a broadcast id");

  let englishCaptionsSet = false;
  if (options.englishCaptions !== false) {
    // Declaring the audio language is what gets YouTube to generate English
    // automatic captions. Best-effort: a channel that can't caption shouldn't
    // stop the service going live.
    try {
      await setEnglishAudioLanguage(yt, broadcastId);
      englishCaptionsSet = true;
    } catch (err) {
      console.error(`[youtube] could not set English audio language on ${broadcastId}:`, err);
    }
  }

  return { broadcastId, englishCaptionsSet };
}

/**
 * Returns the destination's persistent stream key, creating the stream
 * resource the first time.
 *
 * `isReusable` is what makes the key survive the broadcast: the same
 * ingestion address and stream name come back every week, so the encoder
 * target never changes. A stored id that YouTube no longer recognises (the
 * stream was deleted in Studio) transparently becomes a new one.
 */
export async function ensureReusableStream(
  refreshToken: string,
  title: string,
  existingStreamId?: string | null,
): Promise<{ streamId: string; rtmpUrl: string }> {
  const yt = google.youtube({ version: "v3", auth: clientForRefreshToken(refreshToken) });

  if (existingStreamId) {
    const found = await yt.liveStreams.list({ part: ["cdn", "status"], id: [existingStreamId] });
    const existing = found.data.items?.[0];
    if (existing?.id) {
      return { streamId: existing.id, rtmpUrl: rtmpUrlFor(existing.cdn?.ingestionInfo, existing.id) };
    }
    console.warn(
      `[youtube] stored stream ${existingStreamId} no longer exists on the channel — creating a new one`,
    );
  }

  const created = await yt.liveStreams.insert({
    part: ["snippet", "cdn", "contentDetails"],
    requestBody: {
      snippet: { title },
      cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
      contentDetails: { isReusable: true },
    },
  });
  const streamId = created.data.id;
  if (!streamId) throw new Error("YouTube did not return a stream id");
  return { streamId, rtmpUrl: rtmpUrlFor(created.data.cdn?.ingestionInfo, streamId) };
}

/** Points a reserved broadcast at the destination's persistent stream. Called at start time, not at reservation time. */
export async function bindBroadcastToStream(
  refreshToken: string,
  broadcastId: string,
  streamId: string,
): Promise<void> {
  const yt = google.youtube({ version: "v3", auth: clientForRefreshToken(refreshToken) });
  await yt.liveBroadcasts.bind({ id: broadcastId, part: ["id"], streamId });
}

/** Reserve, resolve the persistent key, and bind — the whole thing, for going live right now. */
export async function createAndStartBroadcast(
  refreshToken: string,
  title: string,
  scheduledStartTime: Date,
  options: BroadcastOptions = {},
): Promise<BroadcastResult> {
  const { broadcastId, englishCaptionsSet } = await reserveBroadcast(
    refreshToken,
    title,
    scheduledStartTime,
    options,
  );
  const { streamId, rtmpUrl } = await ensureReusableStream(refreshToken, title, options.reuseStreamId);
  await bindBroadcastToStream(refreshToken, broadcastId, streamId);
  return { broadcastId, rtmpUrl, streamId, englishCaptionsSet };
}

/**
 * Builds the push URL from a stream's ingestion info.
 *
 * `ingestionAddress` is YouTube's PRIMARY ingest. The response also carries
 * `backupIngestionAddress` for the same key — that one is reserved for a
 * second, redundant encoder and is never read here, because two encoders on
 * the backup slot is an error YouTube fails the whole broadcast over.
 */
function rtmpUrlFor(
  ingestionInfo: { ingestionAddress?: string | null; streamName?: string | null } | undefined | null,
  streamId: string,
): string {
  if (!ingestionInfo?.ingestionAddress || !ingestionInfo?.streamName) {
    throw new Error(`YouTube did not return an RTMP ingestion address for stream ${streamId}`);
  }
  const rtmpUrl = `${ingestionInfo.ingestionAddress.replace(/\/+$/, "")}/${ingestionInfo.streamName}`;
  assertPrimaryIngest(rtmpUrl, `the ingestion address YouTube returned for stream ${streamId}`);
  return rtmpUrl;
}

/**
 * videos.update replaces the parts it is given, so the existing snippet is
 * read back first and only the language fields changed — otherwise the title
 * and category would be cleared.
 */
async function setEnglishAudioLanguage(
  yt: ReturnType<typeof google.youtube>,
  videoId: string,
): Promise<void> {
  const existing = await yt.videos.list({ part: ["snippet"], id: [videoId] });
  const snippet = existing.data.items?.[0]?.snippet;
  if (!snippet) return;

  await yt.videos.update({
    part: ["snippet"],
    requestBody: {
      id: videoId,
      snippet: {
        title: snippet.title,
        categoryId: snippet.categoryId,
        description: snippet.description,
        tags: snippet.tags,
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
    },
  });
}

/**
 * Drops a finished broadcast out of the channel's public listings. It stays
 * watchable by link. Reads the current status first so updating privacy does
 * not clear the made-for-kids declaration alongside it.
 */
export async function unlistBroadcast(refreshToken: string, broadcastId: string): Promise<void> {
  const yt = google.youtube({ version: "v3", auth: clientForRefreshToken(refreshToken) });
  const existing = await yt.liveBroadcasts.list({ part: ["status"], id: [broadcastId] });
  const status = existing.data.items?.[0]?.status;

  await yt.liveBroadcasts.update({
    part: ["status"],
    requestBody: {
      id: broadcastId,
      status: {
        privacyStatus: "unlisted",
        selfDeclaredMadeForKids: status?.selfDeclaredMadeForKids ?? false,
      },
    },
  });
}
