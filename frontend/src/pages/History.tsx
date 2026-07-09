import { useEffect, useState } from "react";
import { api, type StreamSession } from "../api";

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const totalMinutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function History() {
  const [sessions, setSessions] = useState<StreamSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listHistory()
      .then(setSessions)
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div>
      <h2>History</h2>
      {error && <p className="error">{error}</p>}
      <table className="destinations-table">
        <thead>
          <tr>
            <th>Destination</th>
            <th>Platform</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{s.destinationName}</td>
              <td>{s.platform}</td>
              <td>{new Date(s.startedAt).toLocaleString()}</td>
              <td>{formatDuration(s.startedAt, s.endedAt)}</td>
              <td>{s.status}</td>
            </tr>
          ))}
          {sessions.length === 0 && (
            <tr>
              <td colSpan={5}>No stream sessions yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
