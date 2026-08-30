import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type Destination,
  type DestinationDraft,
  type Platform,
  type RelayState,
} from "../api";
import StatusBadge from "../components/StatusBadge";

// YouTube isn't offered here — it's connected via OAuth ("Connect YouTube
// channel" below), since it needs a linked account rather than a static
// server URL/key.
const STATIC_PLATFORMS: { value: Platform; label: string }[] = [
  { value: "subsplash", label: "Subsplash" },
  { value: "facebook", label: "Facebook (coming soon)" },
];

const emptyDraft: DestinationDraft = {
  name: "",
  platform: "subsplash",
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
  const [searchParams, setSearchParams] = useSearchParams();

  const justConnectedYoutube = searchParams.get("connected") === "youtube";

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

  useEffect(() => {
    if (justConnectedYoutube) {
      const timeout = setTimeout(() => setSearchParams({}, { replace: true }), 5000);
      return () => clearTimeout(timeout);
    }
  }, [justConnectedYoutube, setSearchParams]);

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

  async function handleDelete(destination: Destination) {
    const message =
      destination.platform === "youtube"
        ? `Delete “${destination.name}” and disconnect its YouTube channel?`
        : `Delete “${destination.name}”?`;
    if (!confirm(message)) return;
    const id = destination.id;
    await api.deleteDestination(id);
    await refresh();
  }

  // Purely configuration: whether scheduled streams use this destination.
  // Nothing goes live here — the scheduler starts and stops relays.
  async function handleToggleScheduled(destination: Destination) {
    try {
      if (destination.enabled) {
        await api.disableDestination(destination.id);
      } else {
        await api.enableDestination(destination.id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Destinations</h2>
        <div className="header-actions">
          <a className="button-link" href="/api/youtube/auth">
            Connect YouTube channel
          </a>
          <button onClick={startCreate}>+ Add destination</button>
        </div>
      </div>

      <p className="hint">
        “In schedule” marks a destination for use by scheduled streams. Streaming starts and stops on
        the schedule — there is nothing to switch on here.
      </p>

      {justConnectedYoutube && <p className="success">YouTube channel connected.</p>}
      {error && <p className="error">{error}</p>}

      <table className="destinations-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Platform</th>
            <th>Stream key / channel</th>
            <th>In schedule</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {destinations.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.platform}</td>
              <td>
                {d.platform === "youtube" ? (
                  <span className="linked-channel">
                    {d.youtubeChannelTitle ?? <em>no channel linked</em>}
                    {d.youtubeLinkedAt && (
                      <small>linked {new Date(d.youtubeLinkedAt).toLocaleString()}</small>
                    )}
                  </span>
                ) : d.hasStreamKey ? (
                  d.streamKeyPreview
                ) : (
                  <em>not set</em>
                )}
              </td>
              <td>
                <label className="schedule-toggle">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={() => handleToggleScheduled(d)}
                  />
                  <span>{d.enabled ? "Yes" : "No"}</span>
                </label>
              </td>
              <td>
                <StatusBadge status={statuses[d.id]} />
              </td>
              <td className="actions">
                {d.platform !== "youtube" && <button onClick={() => startEdit(d)}>Edit</button>}
                <button onClick={() => handleDelete(d)}>Delete</button>
              </td>
            </tr>
          ))}
          {destinations.length === 0 && (
            <tr>
              <td colSpan={6}>No destinations yet — connect YouTube or add Subsplash to get started.</td>
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
              {STATIC_PLATFORMS.map((p) => (
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
              placeholder="rtmp://ingest.example.com/live"
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
