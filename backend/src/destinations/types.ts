export type Platform = "youtube" | "subsplash" | "facebook";

export const PLATFORMS: readonly Platform[] = ["youtube", "subsplash", "facebook"];

export interface DestinationInput {
  name: string;
  platform: Platform;
  // Static platforms (subsplash/facebook): fixed RTMP server + key.
  serverUrl?: string;
  streamKey?: string;
  // youtube: links to a connected account instead — YouTube issues a
  // fresh RTMP key per broadcast, created at enable time.
  youtubeAccountId?: string;
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
  // Which connected channel a YouTube destination pushes to, and when it was
  // linked — the only way to tell two same-named channels apart in the UI.
  youtubeChannelTitle: string | null;
  youtubeLinkedAt: string | null;
  enabled: boolean;
  createdAt: string;
}
