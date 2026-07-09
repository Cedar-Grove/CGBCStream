import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import type { RecurrenceType, ScheduleInput, SchedulePublic } from "./types.js";

interface Row {
  id: string;
  title: string;
  recurrence_type: string;
  day_of_week: number | null;
  date: string | null;
  time: string;
  duration_minutes: number;
  auto_create_youtube: number;
  destination_ids: string;
  active: number;
  created_at: string;
}

function toPublic(row: Row): SchedulePublic {
  return {
    id: row.id,
    title: row.title,
    recurrenceType: row.recurrence_type as RecurrenceType,
    dayOfWeek: row.day_of_week,
    date: row.date,
    time: row.time,
    durationMinutes: row.duration_minutes,
    autoCreateYoutube: !!row.auto_create_youtube,
    destinationIds: JSON.parse(row.destination_ids) as string[],
    active: !!row.active,
    createdAt: row.created_at,
  };
}

export function listSchedules(): SchedulePublic[] {
  return (db.prepare("SELECT * FROM schedules ORDER BY created_at").all() as Row[]).map(toPublic);
}

export function listActiveSchedules(): SchedulePublic[] {
  return (db.prepare("SELECT * FROM schedules WHERE active = 1").all() as Row[]).map(toPublic);
}

function getRow(id: string): Row | undefined {
  return db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Row | undefined;
}

export function createSchedule(input: ScheduleInput): SchedulePublic {
  const row: Row = {
    id: randomUUID(),
    title: input.title,
    recurrence_type: input.recurrenceType,
    day_of_week: input.dayOfWeek ?? null,
    date: input.date ?? null,
    time: input.time,
    duration_minutes: input.durationMinutes,
    auto_create_youtube: input.autoCreateYoutube ? 1 : 0,
    destination_ids: JSON.stringify(input.destinationIds ?? []),
    active: input.active === false ? 0 : 1,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO schedules
       (id, title, recurrence_type, day_of_week, date, time, duration_minutes, auto_create_youtube, destination_ids, active, created_at)
     VALUES (@id, @title, @recurrence_type, @day_of_week, @date, @time, @duration_minutes, @auto_create_youtube, @destination_ids, @active, @created_at)`,
  ).run(row);
  return toPublic(row);
}

export function updateSchedule(id: string, input: Partial<ScheduleInput>): SchedulePublic | undefined {
  const existing = getRow(id);
  if (!existing) return undefined;

  const updated: Row = {
    ...existing,
    title: input.title ?? existing.title,
    recurrence_type: input.recurrenceType ?? existing.recurrence_type,
    day_of_week: input.dayOfWeek !== undefined ? input.dayOfWeek : existing.day_of_week,
    date: input.date !== undefined ? input.date : existing.date,
    time: input.time ?? existing.time,
    duration_minutes: input.durationMinutes ?? existing.duration_minutes,
    auto_create_youtube:
      input.autoCreateYoutube !== undefined ? (input.autoCreateYoutube ? 1 : 0) : existing.auto_create_youtube,
    destination_ids: input.destinationIds ? JSON.stringify(input.destinationIds) : existing.destination_ids,
    active: input.active !== undefined ? (input.active ? 1 : 0) : existing.active,
  };
  db.prepare(
    `UPDATE schedules SET
       title=@title, recurrence_type=@recurrence_type, day_of_week=@day_of_week, date=@date,
       time=@time, duration_minutes=@duration_minutes, auto_create_youtube=@auto_create_youtube,
       destination_ids=@destination_ids, active=@active
     WHERE id=@id`,
  ).run(updated);
  return toPublic(updated);
}

export function deleteSchedule(id: string): boolean {
  return db.prepare("DELETE FROM schedules WHERE id = ?").run(id).changes > 0;
}
