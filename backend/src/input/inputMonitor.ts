const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL ?? "http://mediamtx:9997";
// Matches the "cgbcstream" user in mediamtx/mediamtx.yml's authInternalUsers —
// MediaMTX's control API rejects unauthenticated requests from anywhere but
// 127.0.0.1 inside its own container, which this backend, a separate
// container, isn't.
const MEDIAMTX_API_USER = "cgbcstream";
const MEDIAMTX_API_PASSWORD = process.env.MEDIAMTX_API_PASSWORD;

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
    const headers: Record<string, string> = {};
    if (MEDIAMTX_API_PASSWORD) {
      const credentials = Buffer.from(`${MEDIAMTX_API_USER}:${MEDIAMTX_API_PASSWORD}`).toString("base64");
      headers.Authorization = `Basic ${credentials}`;
    }
    const res = await fetch(`${MEDIAMTX_API_URL}/v3/paths/get/${pathName}`, { headers });
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
