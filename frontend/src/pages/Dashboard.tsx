import { useEffect, useState } from "react";
import { api, type Destination, type RelayState } from "../api";
import StatusBadge from "../components/StatusBadge";

export default function Dashboard() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RelayState>>({});

  useEffect(() => {
    async function refresh() {
      const [dests, statusMap] = await Promise.all([api.listDestinations(), api.relayStatus()]);
      setDestinations(dests);
      setStatuses(statusMap);
    }
    refresh().catch(() => {});
    const interval = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      <p className="muted">
        Input preview and schedule status arrive in a later phase — for now this shows live
        status per destination.
      </p>
      <div className="status-cards">
        {destinations.map((d) => (
          <div className="status-card" key={d.id}>
            <h3>{d.name}</h3>
            <p className="muted">{d.platform}</p>
            <StatusBadge enabled={d.enabled} status={statuses[d.id]} />
          </div>
        ))}
        {destinations.length === 0 && <p>No destinations configured yet.</p>}
      </div>
    </div>
  );
}
