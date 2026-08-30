import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

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
): Promise<{ channelTitle: string; refreshToken: string }> {
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
  const channelTitle = channels.data.items?.[0]?.snippet?.title ?? "YouTube channel";

  return { channelTitle, refreshToken: tokens.refresh_token };
}

function clientForRefreshToken(refreshToken: string): OAuth2Client {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface BroadcastResult {
  broadcastId: string;
  rtmpUrl: string;
}

/**
 * Creates a broadcast + stream and binds them, with enableAutoStart/
 * enableAutoStop so YouTube itself transitions the broadcast live once
 * it sees RTMP data (and ends it once the feed stops) — no separate
 * transition() calls needed on our side.
 */
export async function createAndStartBroadcast(
  refreshToken: string,
  title: string,
  scheduledStartTime: Date,
  privacyStatus: "public" | "unlisted" | "private" = "public",
): Promise<BroadcastResult> {
  const auth = clientForRefreshToken(refreshToken);
  const yt = google.youtube({ version: "v3", auth });

  const broadcast = await yt.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title,
        scheduledStartTime: scheduledStartTime.toISOString(),
      },
      status: { privacyStatus },
      contentDetails: { enableAutoStart: true, enableAutoStop: true },
    },
  });

  const stream = await yt.liveStreams.insert({
    part: ["snippet", "cdn"],
    requestBody: {
      snippet: { title },
      cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
    },
  });

  const broadcastId = broadcast.data.id;
  const streamId = stream.data.id;
  if (!broadcastId || !streamId) {
    throw new Error("YouTube did not return broadcast/stream ids");
  }

  await yt.liveBroadcasts.bind({ id: broadcastId, part: ["id"], streamId });

  // Declaring the audio language is what gets YouTube to generate English
  // automatic captions. Best-effort: a channel that can't caption shouldn't
  // stop the service going live.
  try {
    await setEnglishAudioLanguage(yt, broadcastId);
  } catch (err) {
    console.error(`[youtube] could not set English audio language on ${broadcastId}:`, err);
  }

  const ingestionInfo = stream.data.cdn?.ingestionInfo;
  if (!ingestionInfo?.ingestionAddress || !ingestionInfo?.streamName) {
    throw new Error("YouTube did not return an RTMP ingestion address");
  }

  return {
    broadcastId,
    rtmpUrl: `${ingestionInfo.ingestionAddress.replace(/\/+$/, "")}/${ingestionInfo.streamName}`,
  };
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
