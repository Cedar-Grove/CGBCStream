import type { RelayState } from "../api";

/**
 * Live relay state only. Deliberately independent of a destination's
 * `enabled` flag, which says whether scheduled streams use the destination —
 * not whether it is streaming right now.
 */
export default function StatusBadge({ status }: { status?: RelayState }) {
  if (!status || status.status === "stopped") {
    return <span className="badge badge-off">Idle</span>;
  }
  if (status.status === "running") {
    return <span className="badge badge-live">Live</span>;
  }
  if (status.status === "starting") {
    return <span className="badge badge-starting">Starting…</span>;
  }
  if (status.status === "waiting") {
    return <span className="badge badge-waiting">Waiting for stream</span>;
  }
  return (
    <span className="badge badge-error" title={status.lastError ?? undefined}>
      Error
    </span>
  );
}
