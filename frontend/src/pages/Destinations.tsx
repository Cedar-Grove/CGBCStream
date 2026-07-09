import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type Destination,
  type DestinationDraft,
  type Platform,
  type RelayState,
} from "../api";
import StatusBadge from "../components/StatusBadge";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "subsplash", label: "Subsplash" },
  { value: "facebook", label: "Facebook (coming soon)" },
];

const emptyDraft: DestinationDraft = {
  name: "",
  platform: "youtube",
  serverUrl: "",
  streamKey: "",
};

export default function Destinations() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RelayState>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DestinationDraft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [dests, statusMap] = await Promise.all([api.listDestinations(), api.relayStatus()]);
    setDestinations(dests);
    setStatuses(statusMap);
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
    const interval = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, []);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function startEdit(destination: Destination) {
    setEditingId(destination.id);
    setDraft({
      name: destination.name,
      platform: destination.platform,
      serverUrl: destination.serverUrl,
      streamKey: "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        const payload: Partial<DestinationDraft> = { ...draft };
        if (!payload.streamKey) delete payload.streamKey;
        await api.updateDestination(editingId, payload);
      } else {
        await api.createDestination(draft);
      }
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this destination?")) return;
    await api.deleteDestination(id);
    await refresh();
  }

  async function handleToggle(destination: Destination) {
    if (destination.enabled) {
      await api.disableDestination(destination.id);
    } else {
      await api.enableDestination(destination.id);
    }
    await refresh();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Destinations</h2>
        <button onClick={startCreate}>+ Add destination</button>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="destinations-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Platform</th>
            <th>Stream key</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {destinations.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.platform}</td>
              <td>{d.hasStreamKey ? d.streamKeyPreview : <em>not set</em>}</td>
              <td>
                <StatusBadge enabled={d.enabled} status={statuses[d.id]} />
              </td>
              <td className="actions">
                <button onClick={() => handleToggle(d)}>{d.enabled ? "Disable" : "Enable"}</button>
                <button onClick={() => startEdit(d)}>Edit</button>
                <button onClick={() => handleDelete(d.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {destinations.length === 0 && (
            <tr>
              <td colSpan={5}>No destinations yet — add YouTube or Subsplash to get started.</td>
            </tr>
          )}
        </tbody>
      </table>

      {formOpen && (
        <form className="destination-form" onSubmit={handleSubmit}>
          <h3>{editingId ? "Edit destination" : "Add destination"}</h3>
          <label>
            Name
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Platform
            <select
              value={draft.platform}
              onChange={(e) => setDraft({ ...draft, platform: e.target.value as Platform })}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Server URL
            <input
              required
              placeholder="rtmp://a.rtmp.youtube.com/live2"
              value={draft.serverUrl}
              onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })}
            />
          </label>
          <label>
            Stream key {editingId && <small>(leave blank to keep current)</small>}
            <input
              type="password"
              required={!editingId}
              value={draft.streamKey}
              onChange={(e) => setDraft({ ...draft, streamKey: e.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
