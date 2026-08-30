import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";

export interface YoutubeAccountPublic {
  id: string;
  channelTitle: string;
  createdAt: string;
}

interface Row {
  id: string;
  channel_id: string | null;
  channel_title: string;
  refresh_token: string;
  created_at: string;
}

/**
 * Stores the credentials for a channel. Reconnecting a channel that is already
 * linked replaces its refresh token rather than adding a second account —
 * connecting twice used to leave duplicates that were impossible to tell apart
 * in the UI, one of them holding a token that would quietly expire.
 */
export function upsertAccount(
  channelId: string,
  channelTitle: string,
  refreshToken: string,
): { account: YoutubeAccountPublic; isNew: boolean } {
  const existing = db
    .prepare("SELECT * FROM youtube_accounts WHERE channel_id = ?")
    .get(channelId) as Row | undefined;

  if (existing) {
    db.prepare(
      "UPDATE youtube_accounts SET channel_title = ?, refresh_token = ? WHERE id = ?",
    ).run(channelTitle, encryptSecret(refreshToken), existing.id);
    return {
      account: { id: existing.id, channelTitle, createdAt: existing.created_at },
      isNew: false,
    };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO youtube_accounts (id, channel_id, channel_title, refresh_token, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, channelId, channelTitle, encryptSecret(refreshToken), createdAt);
  return { account: { id, channelTitle, createdAt }, isNew: true };
}

export function listAccounts(): YoutubeAccountPublic[] {
  const rows = db.prepare("SELECT * FROM youtube_accounts ORDER BY created_at").all() as Row[];
  return rows.map((row) => ({ id: row.id, channelTitle: row.channel_title, createdAt: row.created_at }));
}

export function getRefreshToken(accountId: string): string | undefined {
  const row = db.prepare("SELECT refresh_token FROM youtube_accounts WHERE id = ?").get(accountId) as
    | Row
    | undefined;
  return row ? decryptSecret(row.refresh_token) : undefined;
}

export function deleteAccount(id: string): boolean {
  return db.prepare("DELETE FROM youtube_accounts WHERE id = ?").run(id).changes > 0;
}
