import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/cgbcstream.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS destinations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    server_url TEXT NOT NULL,
    stream_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS youtube_accounts (
    id TEXT PRIMARY KEY,
    channel_title TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    recurrence_type TEXT NOT NULL,
    day_of_week INTEGER,
    date TEXT,
    time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    auto_create_youtube INTEGER NOT NULL DEFAULT 1,
    destination_ids TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- A YouTube broadcast reserved ahead of a scheduled occurrence. Keyed by
  -- (schedule, destination, occurrence) so two services on the same day each
  -- resolve to their own broadcast. rtmp_url embeds the stream key, so it is
  -- encrypted at rest like destinations.stream_key.
  CREATE TABLE IF NOT EXISTS prepared_broadcasts (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    occurrence_start TEXT NOT NULL,
    broadcast_id TEXT NOT NULL,
    rtmp_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (schedule_id, destination_id, occurrence_start)
  );

  CREATE TABLE IF NOT EXISTS stream_sessions (
    id TEXT PRIMARY KEY,
    destination_id TEXT,
    destination_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    schedule_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    youtube_broadcast_id TEXT,
    status TEXT NOT NULL
  );
`);

/** Adds a column to an existing table if it isn't there yet — SQLite has no "ADD COLUMN IF NOT EXISTS". */
function ensureColumn(table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// YouTube destinations link to a connected account instead of a static
// server URL/key (YouTube issues a fresh RTMP key per broadcast).
ensureColumn("destinations", "youtube_account_id", "youtube_account_id TEXT");
