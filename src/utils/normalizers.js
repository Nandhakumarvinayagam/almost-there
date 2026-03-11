/**
 * Data normalizers for Firebase RTDB session and participant data.
 *
 * These functions act as safety gates, ensuring every React component receives
 * a consistent data structure regardless of whether the session was created
 * before or after the Social Edition update.
 *
 * Reference: Plan v5, Sections 2 and 4
 */

/**
 * Converts a timestamp value to epoch milliseconds.
 * Handles both numeric epoch ms and legacy ISO string formats.
 * Returns null for missing/invalid values.
 *
 * @param {number|string|null|undefined} val
 * @returns {number|null}
 */
const toTimestamp = (val) => {
  if (!val) return null;
  if (typeof val === "number") return val;
  // Legacy ISO string — convert to epoch ms
  const parsed = new Date(val).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Normalizes session data from Firebase RTDB.
 * Handles backward compatibility for legacy ISO timestamps, missing nodes,
 * and all Social Edition schema extensions.
 *
 * All components MUST read session data through this normalizer, never raw Firebase data.
 *
 * Reference: Plan v5, Sections 2 and 4
 *
 * @param {object|null} rawData - Raw session snapshot from Firebase
 * @returns {object|null}
 */
export const normalizeSession = (rawData) => {
  if (!rawData) return null;

  return {
    ...rawData,

    // --- Section 4, Rule 1: State Machine Default ---
    // Legacy sessions lack `state`; treat as 'active' (preserves current behavior)
    state: rawData.state || "active",

    // --- Section 4, Rule 2: Host Identity ---
    hostId: rawData.hostId || null,
    hostSecretHash: rawData.hostSecretHash || null,

    // --- Section 4, Rule 3: Theme Default ---
    theme: {
      color: rawData.theme?.color || "#0066CC",
      emoji: rawData.theme?.emoji || "📍",
      style: rawData.theme?.style || "classic",
    },

    // --- Section 4, Rule 8: Timestamp Normalization ---
    // Legacy sessions may store these as ISO strings like "2026-03-15T19:00:00Z".
    // Firebase security rules use `now` (epoch ms number), so all timestamp
    // comparisons require numeric storage.
    scheduledTime: toTimestamp(rawData.scheduledTime),
    createdAt: toTimestamp(rawData.createdAt) || Date.now(),
    expiresAt: toTimestamp(rawData.expiresAt) || Date.now(),

    // --- Section 4, Rule 4: Headcount Migration ---
    // If headcount is not a number, return null so the caller (useSession)
    // can detect this and run the migration-on-read transaction.
    // The normalizer does NOT run the transaction — that's the caller's job.
    headcount: typeof rawData.headcount === "number" ? rawData.headcount : null,

    // --- Section 4, Rule 9: Permissions & Safety ---
    permissions: rawData.permissions || { coHosts: {} },
    blockedUsers: rawData.blockedUsers || {},

    // --- Section 4, Rule 9: Social Features ---
    logistics: rawData.logistics || {},
    poll: rawData.poll || null,
    customFields: rawData.customFields || {},
    activityFeed: rawData.activityFeed || {},
    reactions: rawData.reactions || {},

    // --- Stops/Waypoints ---
    // Firebase RTDB stores arrays as objects ({0: ..., 1: ...}); coerce back to array.
    stops: Array.isArray(rawData.stops) ? rawData.stops : rawData.stops ? Object.values(rawData.stops) : [],

    // --- Arrival Radius Default ---
    // Legacy sessions without an explicit arrivalRadius get the new default of 250m.
    // Sessions that stored 100 explicitly keep their stored value (|| only triggers on falsy).
    arrivalRadius: rawData.arrivalRadius || 250,
  };
};

/**
 * Normalizes participant data from Firebase RTDB.
 * Ensures all Social Edition fields exist with safe defaults.
 *
 * All components MUST read participant data through this normalizer,
 * never raw Firebase data.
 *
 * Reference: Plan v5, Sections 2 and 4
 *
 * @param {object|null} rawData - Raw participant snapshot from Firebase
 * @returns {object|null}
 */
export const normalizeParticipant = (rawData) => {
  if (!rawData) return null;

  return {
    ...rawData,

    // --- Core Identity ---
    name: rawData.name || "Anonymous",

    // --- Section 4, Rule 5: Legacy Join Default ---
    // Users who joined before the Social Edition update intended to participate,
    // so default to 'going' (not null)
    rsvpStatus: rawData.rsvpStatus || "going",

    // --- Social Fields ---
    plusOnes: rawData.plusOnes || 0,
    guestNote: rawData.guestNote || null,
    pollVote: rawData.pollVote || null,
    customResponses: rawData.customResponses || {},
    myReactions: rawData.myReactions || {},

    // --- Section 4, Rule 6: Privacy Default ---
    visibility: rawData.visibility || "visible",

    // --- Location & Status ---
    nearbyStatus: rawData.nearbyStatus || false,
    status: rawData.status || "not-started",
    // location and eta are not defaulted — null means "not tracking"

    // --- Phase 4: Highlight Memory ---
    highlightMemory: rawData.highlightMemory || null,

    // --- Avatars ---
    avatarId: rawData.avatarId ?? null,
  };
};
