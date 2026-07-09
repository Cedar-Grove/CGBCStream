import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import type { SessionStatus, StreamSession } from "./types.js";

interface Row {
  id: string;
  destination_id: string | null;
  destination_name: string;
  platform: string;
  schedule_id: string | null;
  started_at: string;
  ended_at: string | null;
  youtube_broadcast_id: string | null;
  status: SessionStatus;
}

function toPublic(row: Row): StreamSession {
  return {
    id: row.id,
    destinationId: row.destination_id,
    destinationName: row.destination_name,
    platform: row.platform,
    scheduleId: row.schedule_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    youtubeBroadcastId: row.youtube_broadcast_id,
    status: row.status,
  };
}

export function startSession(params: {
  destinationId: string;
  destinationName: string;
  platform: string;
  scheduleId?: string | null;
  youtubeBroadcastId?: string | null;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO stream_sessions
       (id, destination_id, destination_name, platform, schedule_id, started_at, ended_at, youtube_broadcast_id, status)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'running')`,
  ).run(
    id,
    params.destinationId,
    params.destinationName,
    params.platform,
    params.scheduleId ?? null,
    new Date().toISOString(),
    params.youtubeBroadcastId ?? null,
  );
  return id;
}

export function endSession(id: string, status: Exclude<SessionStatus, "running"> = "completed"): void {
  db.prepare(`UPDATE stream_sessions SET ended_at = ?, status = ? WHERE id = ?`).run(
    new Date().toISOString(),
    status,
    id,
  );
}

export function listRecentSessions(limit = 100): StreamSession[] {
  const rows = db
    .prepare(`SELECT * FROM stream_sessions ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as Row[];
  return rows.map(toPublic);
}
