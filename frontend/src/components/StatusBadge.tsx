import type { RelayState } from "../api";

export default function StatusBadge({
  enabled,
  status,
}: {
  enabled: boolean;
  status?: RelayState;
}) {
  if (!enabled || !status || status.status === "stopped") {
    return <span className="badge badge-off">Off</span>;
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
