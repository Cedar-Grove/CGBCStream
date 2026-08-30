import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";

export interface PreparedBroadcast {
  broadcastId: string;
  rtmpUrl: string;
}

interface Row {
  broadcast_id: string;
  rtmp_url: string;
}

/**
 * The broadcast reserved for one destination of one schedule occurrence.
 * `occurrenceStart` is the disambiguator: two schedules running on the same
 * day, or the same weekly schedule on different weeks, never collide.
 */
export function getPrepared(
  scheduleId: string,
  destinationId: string,
  occurrenceStart: string,
): PreparedBroadcast | undefined {
  const row = db
    .prepare(
      `SELECT broadcast_id, rtmp_url FROM prepared_broadcasts
       WHERE schedule_id = ? AND destination_id = ? AND occurrence_start = ?`,
    )
    .get(scheduleId, destinationId, occurrenceStart) as Row | undefined;
  if (!row) return undefined;
  return { broadcastId: row.broadcast_id, rtmpUrl: decryptSecret(row.rtmp_url) };
}

export function savePrepared(
  scheduleId: string,
  destinationId: string,
  occurrenceStart: string,
  prepared: PreparedBroadcast,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO prepared_broadcasts
       (id, schedule_id, destination_id, occurrence_start, broadcast_id, rtmp_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    scheduleId,
    destinationId,
    occurrenceStart,
    prepared.broadcastId,
    encryptSecret(prepared.rtmpUrl),
    new Date().toISOString(),
  );
}

/** Occurrences that have long since passed — their keys are dead on YouTube's side anyway. */
export function deletePreparedBefore(cutoffIso: string): void {
  db.prepare("DELETE FROM prepared_broadcasts WHERE occurrence_start < ?").run(cutoffIso);
}
