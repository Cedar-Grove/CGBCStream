import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import type { DestinationInput, DestinationPublic, Platform } from "./types.js";

interface Row {
  id: string;
  name: string;
  platform: Platform;
  server_url: string;
  stream_key: string;
  youtube_account_id: string | null;
  enabled: number;
  created_at: string;
}

function toPublic(row: Row): DestinationPublic {
  const key = decryptSecret(row.stream_key);
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    serverUrl: row.server_url,
    hasStreamKey: key.length > 0,
    streamKeyPreview: key ? `••••${key.slice(-4)}` : "",
    youtubeAccountId: row.youtube_account_id,
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

export function listDestinations(): DestinationPublic[] {
  const rows = db.prepare("SELECT * FROM destinations ORDER BY created_at").all() as Row[];
  return rows.map(toPublic);
}

function getRow(id: string): Row | undefined {
  return db.prepare("SELECT * FROM destinations WHERE id = ?").get(id) as Row | undefined;
}

/** Just enough to decide how to enable a destination, without exposing secrets. */
export function getDestinationMeta(
  id: string,
): { platform: Platform; youtubeAccountId: string | null; name: string } | undefined {
  const row = getRow(id);
  if (!row) return undefined;
  return { platform: row.platform, youtubeAccountId: row.youtube_account_id, name: row.name };
}

/** The full `rtmp://server/streamKey` ffmpeg push target for a static-platform destination, decrypted for use — never exposed via the API. */
export function getFullRtmpUrl(id: string): string | undefined {
  const row = getRow(id);
  if (!row) return undefined;
  const key = decryptSecret(row.stream_key);
  return `${row.server_url.replace(/\/+$/, "")}/${key}`;
}

export function createDestination(input: DestinationInput): DestinationPublic {
  const row: Row = {
    id: randomUUID(),
    name: input.name,
    platform: input.platform,
    server_url: input.serverUrl ?? "",
    stream_key: encryptSecret(input.streamKey ?? ""),
    youtube_account_id: input.youtubeAccountId ?? null,
    enabled: 0,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO destinations (id, name, platform, server_url, stream_key, youtube_account_id, enabled, created_at)
     VALUES (@id, @name, @platform, @server_url, @stream_key, @youtube_account_id, @enabled, @created_at)`,
  ).run(row);
  return toPublic(row);
}

export function updateDestination(
  id: string,
  input: Partial<DestinationInput>,
): DestinationPublic | undefined {
  const existing = getRow(id);
  if (!existing) return undefined;

  const updated: Row = {
    ...existing,
    name: input.name ?? existing.name,
    platform: input.platform ?? existing.platform,
    server_url: input.serverUrl ?? existing.server_url,
    stream_key: input.streamKey ? encryptSecret(input.streamKey) : existing.stream_key,
  };
  db.prepare(
    `UPDATE destinations SET name=@name, platform=@platform, server_url=@server_url, stream_key=@stream_key WHERE id=@id`,
  ).run(updated);
  return toPublic(updated);
}

export function setEnabled(id: string, enabled: boolean): DestinationPublic | undefined {
  const result = db.prepare("UPDATE destinations SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  if (result.changes === 0) return undefined;
  return toPublic(getRow(id)!);
}

export function deleteDestination(id: string): boolean {
  return db.prepare("DELETE FROM destinations WHERE id = ?").run(id).changes > 0;
}

/** Static-platform (subsplash/facebook) destinations only — used to restart relays on boot. YouTube destinations need a fresh broadcast, so they're excluded (see reconcile logic). */
export function listEnabledStaticDestinations(): { id: string; rtmpUrl: string }[] {
  const rows = db
    .prepare("SELECT * FROM destinations WHERE enabled = 1 AND platform != 'youtube'")
    .all() as Row[];
  return rows.map((row) => ({
    id: row.id,
    rtmpUrl: `${row.server_url.replace(/\/+$/, "")}/${decryptSecret(row.stream_key)}`,
  }));
}

/** YouTube's dynamic key doesn't survive a restart — clear any stale "enabled" flag so the UI doesn't lie about being live. */
export function resetYoutubeEnabledState(): void {
  db.prepare("UPDATE destinations SET enabled = 0 WHERE platform = 'youtube' AND enabled = 1").run();
}
