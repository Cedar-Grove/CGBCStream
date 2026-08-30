import type { SchedulePublic } from "./types.js";

export interface OccurrenceWindow {
  start: Date;
  end: Date;
}

/**
 * The occurrence a schedule is either currently inside, or will next
 * start — null once a one-off schedule's occurrence has fully passed.
 * Pure function of (schedule, now) so it's easy to unit-test the date
 * math independently of the tick loop.
 */
export function nextOccurrenceWindow(schedule: SchedulePublic, now: Date): OccurrenceWindow | null {
  const [hourStr, minuteStr] = schedule.time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (schedule.recurrenceType === "once") {
    if (!schedule.date) return null;
    const [y, m, d] = schedule.date.split("-").map(Number);
    const start = new Date(y, m - 1, d, hour, minute, 0, 0);
    const end = new Date(start.getTime() + schedule.durationMinutes * 60_000);
    if (now >= end) return null;
    return { start, end };
  }

  if (schedule.dayOfWeek == null) return null;

  const start = new Date(now);
  start.setHours(hour, minute, 0, 0);
  const dayDiff = (schedule.dayOfWeek - start.getDay() + 7) % 7;
  start.setDate(start.getDate() + dayDiff);

  let end = new Date(start.getTime() + schedule.durationMinutes * 60_000);
  if (now >= end) {
    start.setDate(start.getDate() + 7);
    end = new Date(start.getTime() + schedule.durationMinutes * 60_000);
  }
  return { start, end };
}

/**
 * Local midnight starting the day an occurrence falls on. Local rather than
 * UTC to match the rest of the date math here, which builds occurrence times
 * from the server's own clock.
 */
export function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}
