/**
 * localStorage-backed LRU cache for participant colour preferences.
 *
 * Schema: { [participantName]: { colorIndex: number, lastUsed: ms } }
 * Key:    almostThere_colorPrefs
 *
 * When a user joins a session their stored preference is used as a HINT
 * for which PARTICIPANT_COLORS slot to request.  The final assignment is
 * written back here so they tend to get the same colour across sessions.
 * LRU eviction keeps the store below MAX_ENTRIES entries.
 */

const STORAGE_KEY = 'almostThere_colorPrefs';
const MAX_ENTRIES  = 20;

/**
 * Return the stored preferred colorIndex for a participant name, or null.
 * @param {string} name
 * @returns {number|null}
 */
export function getColorPreference(name) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const prefs = JSON.parse(raw);
    const entry = prefs[name];
    return typeof entry?.colorIndex === 'number' ? entry.colorIndex : null;
  } catch {
    return null;
  }
}

/**
 * Persist the assigned colorIndex for a participant name.
 * Evicts the least-recently-used entry if the cache exceeds MAX_ENTRIES.
 * @param {string} name
 * @param {number} colorIndex
 */
export function setColorPreference(name, colorIndex) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    prefs[name] = { colorIndex, lastUsed: Date.now() };

    // LRU eviction: drop oldest entry when limit exceeded
    const entries = Object.entries(prefs);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (a[1].lastUsed ?? 0) - (b[1].lastUsed ?? 0));
      const toEvict = entries.slice(0, entries.length - MAX_ENTRIES);
      for (const [key] of toEvict) delete prefs[key];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded, etc.)
  }
}
