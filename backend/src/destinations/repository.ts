import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import type { DestinationInput, DestinationMeta, DestinationPublic, Platform } from "./types.js";

interface Row {
  id: string;
  name: string;
  platform: Platform;
  server_url: string;
  stream_key: string;
  youtube_account_id: string | null;
  youtube_stream_id: string | null;
  english_captions: number;
  unlist_after: number;
  enabled: number;
  created_at: string;
  // Joined from youtube_accounts when listing, so the UI can tell two
  // similarly-named channels apart.
  account_channel_title?: string | null;
  account_created_at?: string | null;
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
    hasReusableStreamKey: !!row.youtube_stream_id,
    englishCaptions: !!row.english_captions,
    unlistAfter: !!row.unlist_after,
    youtubeChannelTitle: row.account_channel_title ?? null,
    youtubeLinkedAt: row.account_created_at ?? null,
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

export function listDestinations(): DestinationPublic[] {
  const rows = db
    .prepare(
      `SELECT d.*,
              a.channel_title AS account_channel_title,
              a.created_at    AS account_created_at
       FROM destinations d
       LEFT JOIN youtube_accounts a ON a.id = d.youtube_account_id
       ORDER BY d.created_at`,
    )
    .all() as Row[];
  return rows.map(toPublic);
}

/** The destination already linked to a connected channel, if any. */
export function findDestinationByAccount(accountId: string): DestinationPublic | undefined {
  const row = db
    .prepare("SELECT * FROM destinations WHERE youtube_account_id = ?")
    .get(accountId) as Row | undefined;
  return row ? toPublic(row) : undefined;
}

/** Renames a destination to follow its channel, without touching anything else. */
export function renameDestination(id: string, name: string): void {
  db.prepare("UPDATE destinations SET name = ? WHERE id = ?").run(name, id);
}

/** The connected account a destination uses, so deleting one can disconnect the other. */
export function getYoutubeAccountId(id: string): string | null {
  const row = getRow(id);
  return row?.youtube_account_id ?? null;
}

function getRow(id: string): Row | undefined {
  return db.prepare("SELECT * FROM destinations WHERE id = ?").get(id) as Row | undefined;
}

/** Just enough to decide how to start a destination, without exposing secrets. */
export function getDestinationMeta(id: string): DestinationMeta | undefined {
  const row = getRow(id);
  if (!row) return undefined;
  return {
    platform: row.platform,
    youtubeAccountId: row.youtube_account_id,
    youtubeStreamId: row.youtube_stream_id,
    englishCaptions: !!row.english_captions,
    unlistAfter: !!row.unlist_after,
    name: row.name,
    enabled: !!row.enabled,
  };
}

/** Records the persistent stream YouTube issued, so the next service reuses the same key instead of asking for a new one. */
export function setYoutubeStreamId(id: string, streamId: string): void {
  db.prepare("UPDATE destinations SET youtube_stream_id = ? WHERE id = ?").run(streamId, id);
}

/** The full `rtmp://server/streamKey` ffmpeg push target for a static-platform destination, decrypted for use — never exposed via the API. */
export function getFullRtmpUrl(id: string): string | undefined {
  const row = getRow(id);
  if (!row) return undefined;
  const key = decryptSecret(row.stream_key);
  return `${row.server_url.trim().replace(/\/+$/, "")}/${key}`;
}

function boolColumn(input: boolean | undefined, existing: number): number {
  if (input === undefined) return existing;
  return input ? 1 : 0;
}

export function createDestination(input: DestinationInput): DestinationPublic {
  const row: Row = {
    id: randomUUID(),
    name: input.name,
    platform: input.platform,
    server_url: input.serverUrl ?? "",
    stream_key: encryptSecret(input.streamKey ?? ""),
    youtube_account_id: input.youtubeAccountId ?? null,
    youtube_stream_id: null,
    english_captions: input.englishCaptions === false ? 0 : 1,
    unlist_after: input.unlistAfter === false ? 0 : 1,
    enabled: 0,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO destinations (id, name, platform, server_url, stream_key, youtube_account_id,
                               english_captions, unlist_after, enabled, created_at)
     VALUES (@id, @name, @platform, @server_url, @stream_key, @youtube_account_id,
             @english_captions, @unlist_after, @enabled, @created_at)`,
  ).run(row);
  return toPublic(row);
}

export function updateDestination(
  id: string,
  input: Partial<DestinationInput>,
): DestinationPublic | undefined {
  const existing = getRow(id);
  if (!existing) return undefined;

  // A blank field means "leave this alone" — the edit form sends the stream
  // key blank to keep the stored one, and the same must hold for the rest
  // rather than silently clearing a destination's name or server.
  const updated: Row = {
    ...existing,
    name: input.name?.trim() || existing.name,
    platform: input.platform ?? existing.platform,
    server_url: input.serverUrl?.trim() || existing.server_url,
    stream_key: input.streamKey ? encryptSecret(input.streamKey) : existing.stream_key,
    english_captions: boolColumn(input.englishCaptions, existing.english_captions),
    unlist_after: boolColumn(input.unlistAfter, existing.unlist_after),
  };
  db.prepare(
    `UPDATE destinations SET name=@name, platform=@platform, server_url=@server_url, stream_key=@stream_key,
                             english_captions=@english_captions, unlist_after=@unlist_after
     WHERE id=@id`,
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
