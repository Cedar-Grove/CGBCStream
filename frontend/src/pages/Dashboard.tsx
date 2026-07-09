import { useEffect, useState } from "react";
import { api, type Destination, type InputStatus, type RelayState } from "../api";
import InputPreview from "../components/InputPreview";
import StatusBadge from "../components/StatusBadge";

export default function Dashboard() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RelayState>>({});
  const [inputStatus, setInputStatus] = useState<InputStatus | null>(null);

  useEffect(() => {
    async function refresh() {
      const [dests, statusMap, input] = await Promise.all([
        api.listDestinations(),
        api.relayStatus(),
        api.inputStatus(),
      ]);
      setDestinations(dests);
      setStatuses(statusMap);
      setInputStatus(input);
    }
    refresh().catch(() => {});
    const interval = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>

      <section className="input-section">
        <div className="input-header">
          <h3>Input (Blackmagic Web Presenter)</h3>
          <span className={`badge ${inputStatus?.live ? "badge-live" : "badge-off"}`}>
            {inputStatus?.live ? "Signal present" : "No signal"}
          </span>
        </div>
        <InputPreview live={inputStatus?.live ?? false} />
      </section>

      <h3>Destinations</h3>
      <div className="status-cards">
        {destinations.map((d) => {
          const status = statuses[d.id];
          return (
            <div className="status-card" key={d.id}>
              <h3>{d.name}</h3>
              <p className="muted">{d.platform}</p>
              <StatusBadge enabled={d.enabled} status={status} />
              {status?.status === "running" && status.bitrateKbps != null && (
                <p className="muted">{status.bitrateKbps.toFixed(0)} kbps</p>
              )}
            </div>
          );
        })}
        {destinations.length === 0 && <p>No destinations configured yet.</p>}
      </div>
    </div>
  );
}
