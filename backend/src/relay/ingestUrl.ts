/**
 * Every push target this app uses must be a platform's PRIMARY ingest.
 *
 * YouTube hands out two addresses for the same stream key: the primary
 * (`rtmp://a.rtmp.youtube.com/live2`) and a backup
 * (`rtmp://b.rtmp.youtube.com/live2?backup=1`). The backup endpoint exists
 * for a second, redundant encoder. If this app pushes there too, YouTube
 * sees two encoders on the backup slot and rejects the broadcast
 * ("you are streaming to backup from 2 locations"), which takes the whole
 * service off the air.
 *
 * So: nothing here ever pushes to a backup endpoint. This is the one place
 * that decides what "a backup endpoint" means, and every path that can
 * produce a push URL — the YouTube API response, a hand-entered server URL,
 * a restored reservation — is checked against it.
 */

/** Hosts that are a platform's backup ingest are conventionally the primary host with a `b.` prefix (`b.rtmp.youtube.com`, `b.rtmps.youtube.com`). */
const BACKUP_HOST_PATTERN = /^b\.(rtmps?\.)/i;

/** `?backup=1` appended to the server URL, the other way platforms mark a backup ingest. */
const BACKUP_QUERY_PATTERN = /[?&]backup=/i;

/**
 * Describes why `url` is a backup ingest, or undefined if it is a primary one.
 *
 * Only the host, the query and the non-final path segments are inspected —
 * the last path segment is the stream key, which is opaque and must not be
 * read as routing information.
 */
export function findBackupIngestReason(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  let parsed: URL | undefined;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = undefined;
  }

  if (!parsed) {
    // Unparseable, so fall back to matching the raw text rather than letting
    // an odd-looking URL through unchecked.
    if (BACKUP_QUERY_PATTERN.test(trimmed)) return "it carries a ?backup= flag";
    if (/\/\/b\.rtmps?\./i.test(trimmed)) return "it points at a backup ingest host";
    return undefined;
  }

  if (BACKUP_HOST_PATTERN.test(parsed.hostname)) {
    return `${parsed.hostname} is a backup ingest host`;
  }
  if (BACKUP_QUERY_PATTERN.test(parsed.search)) {
    return "it carries a ?backup= flag";
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.slice(0, -1).some((segment) => segment.toLowerCase() === "backup")) {
    return "its path routes to a backup ingest";
  }
  return undefined;
}

export function isBackupIngestUrl(url: string): boolean {
  return findBackupIngestReason(url) !== undefined;
}

/**
 * Throws if `url` is a backup ingest. `what` names the thing being checked so
 * the message says which destination or reservation is at fault.
 */
export function assertPrimaryIngest(url: string, what: string): void {
  const reason = findBackupIngestReason(url);
  if (!reason) return;
  throw new Error(
    `${what} is a backup ingest URL (${reason}). Only primary ingest may be used — ` +
      "pushing to backup collides with the redundant encoder and YouTube rejects the broadcast.",
  );
}
