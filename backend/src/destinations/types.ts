export type Platform = "youtube" | "subsplash" | "facebook";

export const PLATFORMS: readonly Platform[] = ["youtube", "subsplash", "facebook"];

export interface DestinationInput {
  name: string;
  platform: Platform;
  serverUrl: string;
  streamKey?: string;
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
  enabled: boolean;
  createdAt: string;
}
