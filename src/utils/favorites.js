/**
 * Favorite destinations — persisted in localStorage.
 *
 * Each entry shape:
 *   { id: string, lat, lng, name, address, savedAt: timestamp }
 *
 * Capped at MAX entries. Near-duplicate coordinates (within ~11 m) are rejected
 * so the same place doesn't accumulate multiple entries.
 */

const KEY = 'almost_there_favorites';
const MAX = 10;

/** ~0.0001° ≈ 11 m — tolerance for deduplication. */
const COORD_TOL = 0.0001;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function nearMatch(a, b) {
  return Math.abs(a.lat - b.lat) < COORD_TOL && Math.abs(a.lng - b.lng) < COORD_TOL;
}

/**
 * Save a destination as a favorite. No-op if an entry with the same
 * coordinates already exists.
 *
 * @param {{ lat, lng, name, address }} destination
 * @returns {boolean} true if saved, false if already exists or cap reached
 */
export function saveFavorite(destination) {
  const favs = getFavorites();
  if (favs.some(f => nearMatch(f, destination))) return false;
  const entry = { id: uid(), ...destination, savedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...favs].slice(0, MAX)));
    return true;
  } catch {
    return false;
  }
}

/** Return all favorites, most recently saved first. Always returns an array. */
export function getFavorites() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Remove a favorite by its id.
 * @param {string} id
 */
export function removeFavorite(id) {
  const updated = getFavorites().filter(f => f.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Check whether coordinates are already saved as a favorite.
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
export function isFavorite(lat, lng) {
  return getFavorites().some(f => nearMatch(f, { lat, lng }));
}

/**
 * Find the favorite entry that matches given coordinates, or null.
 * @param {number} lat
 * @param {number} lng
 * @returns {object|null}
 */
export function findFavorite(lat, lng) {
  return getFavorites().find(f => nearMatch(f, { lat, lng })) ?? null;
}
