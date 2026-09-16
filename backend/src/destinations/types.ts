export type Platform = "youtube" | "subsplash" | "facebook";

export const PLATFORMS: readonly Platform[] = ["youtube", "subsplash", "facebook"];

export interface DestinationInput {
  name: string;
  platform: Platform;
  // Static platforms (subsplash/facebook): fixed RTMP server + key.
  serverUrl?: string;
  streamKey?: string;
  // youtube: links to a connected account instead. The stream key comes from
  // a reusable stream resource on the channel, created once and kept.
  youtubeAccountId?: string;
  // Both default to on. English captions declares the broadcast's audio as
  // English so YouTube generates English automatic captions; unlistAfter
  // drops the replay out of the channel's listings when the service ends.
  englishCaptions?: boolean;
  unlistAfter?: boolean;
}

/** Just enough to decide how to start and stop a destination, without exposing secrets. */
export interface DestinationMeta {
  platform: Platform;
  youtubeAccountId: string | null;
  youtubeStreamId: string | null;
  englishCaptions: boolean;
  unlistAfter: boolean;
  name: string;
  enabled: boolean;
}

// Never sends the plaintext stream key back over the API — just enough
// to confirm one is set and let the UI show the tail end of it.
export interface DestinationPublic {
  id: string;
  name: string;
  platform: Platform;
  serverUrl: string;
  hasStreamKey: boolean;
  streamKeyPreview: string;
  youtubeAccountId: string | null;
  // Whether YouTube has issued this destination its persistent stream key yet
  // — it is created on the first service and reused from then on.
  hasReusableStreamKey: boolean;
  englishCaptions: boolean;
  unlistAfter: boolean;
  // Which connected channel a YouTube destination pushes to, and when it was
  // linked — the only way to tell two same-named channels apart in the UI.
  youtubeChannelTitle: string | null;
  youtubeLinkedAt: string | null;
  enabled: boolean;
  createdAt: string;
}
