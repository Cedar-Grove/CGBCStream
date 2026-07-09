export type Platform = "youtube" | "subsplash" | "facebook";

export interface Destination {
  id: string;
  name: string;
  platform: Platform;
  serverUrl: string;
  hasStreamKey: boolean;
  streamKeyPreview: string;
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
};
