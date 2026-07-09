const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL ?? "http://mediamtx:9997";

export interface InputStatus {
  live: boolean;
  tracks: string[];
  bytesReceived: number;
  checkedAt: string;
}

interface MediaMtxPath {
  ready?: boolean;
  tracks?: string[];
  bytesReceived?: number;
}

/** Polls MediaMTX's control API for whether the Web Presenter's feed is currently present. */
export async function getInputStatus(pathName = "live"): Promise<InputStatus> {
  const fallback: InputStatus = {
    live: false,
    tracks: [],
    bytesReceived: 0,
    checkedAt: new Date().toISOString(),
  };
  try {
    const res = await fetch(`${MEDIAMTX_API_URL}/v3/paths/get/${pathName}`);
    if (!res.ok) return fallback;
    const data = (await res.json()) as MediaMtxPath;
    return {
      live: Boolean(data.ready),
      tracks: data.tracks ?? [],
      bytesReceived: data.bytesReceived ?? 0,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}
