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
  channel_title: string;
  refresh_token: string;
  created_at: string;
}

export function createAccount(channelTitle: string, refreshToken: string): YoutubeAccountPublic {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO youtube_accounts (id, channel_title, refresh_token, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, channelTitle, encryptSecret(refreshToken), createdAt);
  return { id, channelTitle, createdAt };
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
