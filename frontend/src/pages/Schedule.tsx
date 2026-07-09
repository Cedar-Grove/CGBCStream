import { useEffect, useState, type FormEvent } from "react";
import { api, type Destination, type Schedule, type ScheduleDraft } from "../api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const emptyDraft: ScheduleDraft = {
  title: "",
  recurrenceType: "weekly",
  dayOfWeek: 0,
  time: "10:45",
  durationMinutes: 90,
  autoCreateYoutube: true,
  destinationIds: [],
  active: true,
};

function describe(schedule: Schedule): string {
  if (schedule.recurrenceType === "weekly") {
    return `Every ${DAYS[schedule.dayOfWeek ?? 0]} at ${schedule.time}`;
  }
  return `${schedule.date} at ${schedule.time}`;
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [sch, dest] = await Promise.all([api.listSchedules(), api.listDestinations()]);
    setSchedules(sch);
    setDestinations(dest);
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function startEdit(schedule: Schedule) {
    setEditingId(schedule.id);
    setDraft({
      title: schedule.title,
      recurrenceType: schedule.recurrenceType,
      dayOfWeek: schedule.dayOfWeek ?? 0,
      date: schedule.date ?? undefined,
      time: schedule.time,
      durationMinutes: schedule.durationMinutes,
      autoCreateYoutube: schedule.autoCreateYoutube,
      destinationIds: schedule.destinationIds,
      active: schedule.active,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await api.updateSchedule(editingId, draft);
      } else {
        await api.createSchedule(draft);
      }
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this schedule?")) return;
    await api.deleteSchedule(id);
    await refresh();
  }

  async function handleToggleActive(schedule: Schedule) {
    await api.updateSchedule(schedule.id, { active: !schedule.active });
    await refresh();
  }

  function toggleDestination(id: string) {
    setDraft((d) => ({
      ...d,
      destinationIds: d.destinationIds.includes(id)
        ? d.destinationIds.filter((x) => x !== id)
        : [...d.destinationIds, id],
    }));
  }

  return (
    <div>
      <div className="page-header">
        <h2>Schedule</h2>
        <button onClick={startCreate}>+ Add schedule</button>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="destinations-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>When</th>
            <th>Duration</th>
            <th>Destinations</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td>{describe(s)}</td>
              <td>{s.durationMinutes} min</td>
              <td>
                {s.destinationIds
                  .map((id) => destinations.find((d) => d.id === id)?.name ?? "(deleted)")
                  .join(", ") || <em>none</em>}
              </td>
              <td>
                <button onClick={() => handleToggleActive(s)}>{s.active ? "Active" : "Paused"}</button>
              </td>
              <td className="actions">
                <button onClick={() => startEdit(s)}>Edit</button>
                <button onClick={() => handleDelete(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {schedules.length === 0 && (
            <tr>
              <td colSpan={6}>No schedules yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {formOpen && (
        <form className="destination-form" onSubmit={handleSubmit}>
          <h3>{editingId ? "Edit schedule" : "Add schedule"}</h3>
          <label>
            Title
            <input
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Recurrence
            <select
              value={draft.recurrenceType}
              onChange={(e) => setDraft({ ...draft, recurrenceType: e.target.value as "weekly" | "once" })}
            >
              <option value="weekly">Weekly</option>
              <option value="once">One-off</option>
            </select>
          </label>
          {draft.recurrenceType === "weekly" ? (
            <label>
              Day of week
              <select
                value={draft.dayOfWeek ?? 0}
                onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}
              >
                {DAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Date
              <input
                type="date"
                required
                value={draft.date ?? ""}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
          )}
          <label>
            Start time
            <input
              type="time"
              required
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              type="number"
              required
              min={1}
              value={draft.durationMinutes}
              onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.autoCreateYoutube}
              onChange={(e) => setDraft({ ...draft, autoCreateYoutube: e.target.checked })}
            />
            Auto-create YouTube broadcast ahead of start
          </label>
          <fieldset>
            <legend>Destinations to go live on</legend>
            {destinations.map((d) => (
              <label key={d.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.destinationIds.includes(d.id)}
                  onChange={() => toggleDestination(d.id)}
                />
                {d.name} ({d.platform})
              </label>
            ))}
            {destinations.length === 0 && <p className="muted">No destinations configured yet.</p>}
          </fieldset>
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
