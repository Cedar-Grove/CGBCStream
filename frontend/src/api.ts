export type Platform = "youtube" | "subsplash" | "facebook";

export interface Destination {
  id: string;
  name: string;
  platform: Platform;
  serverUrl: string;
  hasStreamKey: boolean;
  streamKeyPreview: string;
  youtubeAccountId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface DestinationDraft {
  name: string;
  platform: Platform;
  serverUrl: string;
  streamKey?: string;
}

export type RelayStatus = "stopped" | "starting" | "running" | "error";

export interface RelayState {
  status: RelayStatus;
  startedAt: string | null;
  restarts: number;
  lastError: string | null;
  bitrateKbps: number | null;
}

export interface InputStatus {
  live: boolean;
  tracks: string[];
  bytesReceived: number;
  checkedAt: string;
}

export type RecurrenceType = "weekly" | "once";

export interface Schedule {
  id: string;
  title: string;
  recurrenceType: RecurrenceType;
  dayOfWeek: number | null;
  date: string | null;
  time: string;
  durationMinutes: number;
  autoCreateYoutube: boolean;
  destinationIds: string[];
  active: boolean;
  createdAt: string;
}

export interface ScheduleDraft {
  title: string;
  recurrenceType: RecurrenceType;
  dayOfWeek?: number;
  date?: string;
  time: string;
  durationMinutes: number;
  autoCreateYoutube: boolean;
  destinationIds: string[];
  active: boolean;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listDestinations: () => request<Destination[]>("/destinations"),
  createDestination: (input: DestinationDraft) =>
    request<Destination>("/destinations", { method: "POST", body: JSON.stringify(input) }),
  updateDestination: (id: string, input: Partial<DestinationDraft>) =>
    request<Destination>(`/destinations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteDestination: (id: string) => request<void>(`/destinations/${id}`, { method: "DELETE" }),
  enableDestination: (id: string) =>
    request<{ ok: true }>(`/destinations/${id}/enable`, { method: "POST" }),
  disableDestination: (id: string) =>
    request<{ ok: true }>(`/destinations/${id}/disable`, { method: "POST" }),
  relayStatus: () => request<Record<string, RelayState>>("/relay/status"),
  inputStatus: () => request<InputStatus>("/input/status"),
  listSchedules: () => request<Schedule[]>("/schedules"),
  createSchedule: (input: ScheduleDraft) =>
    request<Schedule>("/schedules", { method: "POST", body: JSON.stringify(input) }),
  updateSchedule: (id: string, input: Partial<ScheduleDraft>) =>
    request<Schedule>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${id}`, { method: "DELETE" }),
};
