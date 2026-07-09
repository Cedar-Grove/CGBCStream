import { randomUUID } from "node:crypto";

export const COOKIE_NAME = "cgbc_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionRecord {
  email: string;
  expiresAt: number;
}

// In-memory session store — fine for a single-instance backend; a
// restart simply signs everyone out (they sign back in with Google).
const sessions = new Map<string, SessionRecord>();

export function createSession(email: string): string {
  const token = randomUUID();
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function getSession(token: string | undefined): SessionRecord | undefined {
  if (!token) return undefined;
  const record = sessions.get(token);
  if (!record) return undefined;
  if (Date.now() > record.expiresAt) {
    sessions.delete(token);
    return undefined;
  }
  return record;
}

export function isValidSession(token: string | undefined): boolean {
  return !!getSession(token);
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}
