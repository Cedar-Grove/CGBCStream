import { randomUUID } from "node:crypto";

export const COOKIE_NAME = "cgbc_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// In-memory session store — fine for a single-instance backend; a
// restart simply signs everyone out (they log back in with the shared
// admin password).
const sessions = new Map<string, number>();

export function createSession(): string {
  const token = randomUUID();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}
