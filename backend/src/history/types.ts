export type SessionStatus = "running" | "completed" | "error";

export interface StreamSession {
  id: string;
  destinationId: string | null;
  destinationName: string;
  platform: string;
  scheduleId: string | null;
  startedAt: string;
  endedAt: string | null;
  youtubeBroadcastId: string | null;
  status: SessionStatus;
}
