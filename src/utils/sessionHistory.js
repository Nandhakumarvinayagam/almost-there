/**
 * Session history — persisted in localStorage.
 *
 * Each entry shape:
 *   { sessionId, destination: { lat, lng, name, address }, nickname: string|null,
 *     date: timestamp, participants: [name, ...], wasHost: bool,
 *     scheduledTime?: number, expiresAt?: number }
 *
 * Capped at MAX entries (newest first). Duplicate sessionIds are deduplicated
 * so a session that gets re-saved (e.g. on re-mount after refresh) doesn't grow
 * the list.
 */

const KEY = 'almost_there_history';
const MAX = 20;

/** Append or update a session entry. Newest entry goes to the front. */
export function saveSession({ sessionId, destination, nickname, date, participants, wasHost, scheduledTime, expiresAt }) {
  const history = getHistory();
  // Remove any existing entry for the same session (idempotent)
  const filtered = history.filter(h => h.sessionId !== sessionId);
  const entry = { sessionId, destination, nickname: nickname ?? null, date, participants, wasHost };
  if (scheduledTime != null) entry.scheduledTime = scheduledTime;
  if (expiresAt     != null) entry.expiresAt     = expiresAt;
  filtered.unshift(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, MAX)));
  } catch {
    // Quota exceeded or private-browsing restriction — silently skip
  }
}

/** Return all history entries, newest first. Always returns an array. */
export function getHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remove all history entries. */
export function clearHistory() {
  localStorage.removeItem(KEY);
}
