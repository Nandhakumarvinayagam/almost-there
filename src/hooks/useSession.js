import { useEffect, useState, useCallback } from "react";
import {
  ref,
  onValue,
  set,
  update,
  remove,
  get,
  push,
} from "firebase/database";
import { db } from "../utils/firebase";
import { SESSION_STATUS, SESSION_TTL, STATUS } from "../config/constants";
import { generateSessionId } from "../utils/sessionId";

/**
 * Create a new session node in Firebase and return the generated sessionId.
 *
 * This is a module-level export (not a hook method) because the session ID
 * does not exist yet at call time — it is generated here.
 *
 * expiresAt logic:
 *   - scheduledTime provided → expiresAt = scheduledTime + SESSION_TTL
 *     (a meetup scheduled for tomorrow must not expire 2 hours from now)
 *   - no scheduledTime       → expiresAt = Date.now() + SESSION_TTL
 *
 * @param {object} params
 * @param {{ lat: number, lng: number, name: string, address: string }} params.destination
 * @param {string}  params.hostId             - Participant ID of the session creator
 * @param {string}  params.hostName           - Display name of the creator
 * @param {string}  [params.nickname]         - Optional meetup nickname (max 40 chars)
 * @param {string}  [params.notes]            - Optional group note (max 200 chars)
 * @param {number}  [params.arrivalRadius=100] - Arrival radius in metres
 * @param {number}  [params.scheduledTime]    - Future Unix timestamp (ms); shifts expiresAt
 * @returns {Promise<string>} The generated 6-char session code
 */
export async function createSession({
  destination,
  hostId,
  hostName,
  nickname,
  notes,
  arrivalRadius = 100,
  scheduledTime,
}) {
  const sessionId = generateSessionId();
  const now = Date.now();

  const cleanedNickname = (nickname ?? "").trim();
  const trimmedNotes = (notes ?? "").trim() || null;

  const sessionData = {
    destination,
    hostId,
    status: SESSION_STATUS.ACTIVE,
    createdAt: now,
    expiresAt: scheduledTime ? scheduledTime + SESSION_TTL : now + SESSION_TTL,
    arrivalRadius,
    ...(cleanedNickname.length > 0 && { nickname: cleanedNickname }),
    ...(trimmedNotes && { notes: trimmedNotes }),
    ...(scheduledTime && { scheduledTime }),
    participants: {
      [hostId]: {
        name: hostName,
        location: null,
        eta: null,
        lastUpdated: now,
        status: STATUS.NOT_STARTED,
      },
    },
  };

  await set(ref(db, `sessions/${sessionId}`), sessionData);
  return sessionId;
}

export function useSession(sessionId) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // 'not-found' | 'load-failed' | null

  useEffect(() => {
    if (!sessionId) return;

    const sessionRef = ref(db, `sessions/${sessionId}`);
    const unsubscribe = onValue(
      sessionRef,
      (snapshot) => {
        setLoading(false);
        if (!snapshot.exists()) {
          setError("not-found");
          return;
        }
        setSession(snapshot.val());
      },
      () => {
        setLoading(false);
        setError("load-failed");
      },
    );

    return () => unsubscribe();
  }, [sessionId]);

  // Add a participant in "not started" state — they must tap "I'm Leaving Now"
  // before location tracking and ETA calculation begin.
  // colorIndex is determined client-side (from colorPrefs + taken slots) and
  // stored in Firebase so ALL clients see the same colour for this participant.
  const joinSession = useCallback(
    async (participantId, name, colorIndex) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          name,
          colorIndex: typeof colorIndex === "number" ? colorIndex : 0,
          location: null,
          eta: null,
          lastUpdated: Date.now(),
          status: STATUS.NOT_STARTED,
        },
      );
    },
    [sessionId],
  );

  // Write initial trip data when the user taps "I'm Leaving Now".
  // Sets status to EN_ROUTE and records location, eta, expectedArrivalTime,
  // routePolyline, travelMode, and optional transitInfo in a single atomic update.
  // tripStartedAt is stored for session recap trip-time calculations.
  const startTrip = useCallback(
    async (
      participantId,
      {
        location,
        eta,
        expectedArrivalTime,
        routePolyline,
        travelMode,
        transitInfo,
        routeDistance,
        routeDistanceMeters,
      },
    ) => {
      const data = {
        location,
        eta,
        expectedArrivalTime,
        routePolyline,
        travelMode: travelMode ?? "DRIVING",
        lastUpdated: Date.now(),
        tripStartedAt: Date.now(),
        status: STATUS.EN_ROUTE,
        routeDistance: routeDistance ?? null,
        routeDistanceMeters: routeDistanceMeters ?? null,
      };
      // Only write transitInfo when present — Firebase removes keys set to null
      if (transitInfo != null) data.transitInfo = transitInfo;
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        data,
      );
    },
    [sessionId],
  );

  // Recalculate route after off-route detection or manual trigger.
  // Updates location, eta, expectedArrivalTime, and routePolyline WITHOUT
  // touching status (participant stays EN_ROUTE). Optionally updates transitInfo.
  // Pass resetBump: true ONLY for manual user-triggered recalculations — this
  // zeroes manualDelayMs and bumpCount so the bump slate is wiped. Off-route
  // auto-recalculations must NOT pass resetBump (the user said they're delayed,
  // a route correction doesn't cancel that delay).
  const updateRoute = useCallback(
    async (
      participantId,
      {
        location,
        eta,
        expectedArrivalTime,
        routePolyline,
        transitInfo,
        resetBump = false,
        routeDistance,
        routeDistanceMeters,
      },
    ) => {
      const data = {
        location,
        eta,
        expectedArrivalTime,
        routePolyline,
        lastUpdated: Date.now(),
        routeDistance: routeDistance ?? null,
        routeDistanceMeters: routeDistanceMeters ?? null,
      };
      if (transitInfo != null) data.transitInfo = transitInfo;
      if (resetBump) {
        data.manualDelayMs = 0;
        data.bumpCount = 0;
      }
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        data,
      );
    },
    [sessionId],
  );

  // Add a manual delay to the participant's ETA without touching expectedArrivalTime.
  // Reads the current manualDelayMs and bumpCount from Firebase, then writes the
  // incremented values. Only the current user calls this for their own participant node.
  const bumpETA = useCallback(
    async (participantId, minutes) => {
      const snap = await get(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
      );
      const current = snap.val() ?? {};
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          manualDelayMs: (current.manualDelayMs ?? 0) + minutes * 60_000,
          bumpCount: (current.bumpCount ?? 0) + 1,
        },
      );
    },
    [sessionId],
  );

  // Switch travel mode mid-trip. Writes the new mode + fresh route data and resets
  // any manual delay adjustments (manualDelayMs, bumpCount) so bump offsets from
  // the previous mode don't carry over to the new route.
  // Always writes transitInfo (null removes the key when switching away from TRANSIT).
  const switchTravelMode = useCallback(
    async (
      participantId,
      {
        travelMode,
        eta,
        expectedArrivalTime,
        routePolyline,
        transitInfo,
        routeDistance,
        routeDistanceMeters,
      },
    ) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          travelMode,
          eta,
          expectedArrivalTime,
          routePolyline,
          lastUpdated: Date.now(),
          manualDelayMs: 0,
          bumpCount: 0,
          // Passing null explicitly removes the key — clears stale transit details
          // when the user switches from TRANSIT to any other mode.
          transitInfo: transitInfo ?? null,
          routeDistance: routeDistance ?? null,
          routeDistanceMeters: routeDistanceMeters ?? null,
        },
      );
    },
    [sessionId],
  );

  // Update the current participant's location in Firebase
  const updateLocation = useCallback(
    async (participantId, location) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          location,
          lastUpdated: Date.now(),
        },
      );
    },
    [sessionId],
  );

  // Write a new status for a participant (e.g. almost-there → arrived).
  // Intentionally doesn't touch location so the last-known pin stays visible.
  // On arrival, distance fields are nulled out (trip is over, no remaining distance).
  const updateStatus = useCallback(
    async (participantId, status) => {
      const data = { status, lastUpdated: Date.now() };
      if (status === STATUS.ARRIVED) {
        data.routeDistance = null;
        data.routeDistanceMeters = null;
        data.statusEmoji = null;
      }
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        data,
      );
    },
    [sessionId],
  );

  // Manual "I'm Here" arrival — same as automatic arrival but also clears routePolyline
  // so the faded route disappears (participant explicitly confirmed they've arrived
  // even though GPS didn't auto-detect it).
  const markArrivedManually = useCallback(
    async (participantId) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          status: STATUS.ARRIVED,
          lastUpdated: Date.now(),
          routeDistance: null,
          routeDistanceMeters: null,
          statusEmoji: null,
          routePolyline: null,
        },
      );
    },
    [sessionId],
  );

  // Host-only: mark the session as completed
  const endSession = useCallback(async () => {
    await update(ref(db, `sessions/${sessionId}`), {
      status: SESSION_STATUS.COMPLETED,
    });
  }, [sessionId]);

  // Write keepVisible flag to an arrived participant's node.
  // true  → pin stays on map even after ARRIVAL_PIN_HIDE_DELAY_MS
  // false → pin auto-hides after the delay (default behaviour)
  const updateKeepVisible = useCallback(
    async (participantId, value) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          keepVisible: value,
        },
      );
    },
    [sessionId],
  );

  // Host-only: update (or clear) the group note
  const updateNotes = useCallback(
    async (notesText) => {
      const trimmed = typeof notesText === "string" ? notesText.trim() : "";
      await update(ref(db, `sessions/${sessionId}`), {
        notes: trimmed || null,
      });
    },
    [sessionId],
  );

  // Write (or clear) the participant's quick status emoji.
  // Passing null removes the field — arriving also clears it via updateStatus.
  const updateStatusEmoji = useCallback(
    async (participantId, emoji) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          statusEmoji: emoji ?? null,
        },
      );
    },
    [sessionId],
  );

  // Write a small event entry to the session activity feed.
  // Uses push() so Firebase auto-generates a chronological push key.
  // Non-critical: failures are silently swallowed so they never break core flows.
  // IMPORTANT: declared before setSpectating/exitSpectating to avoid TDZ in their dep arrays.
  const logEvent = useCallback(
    async (type, participantName, detail = null) => {
      const eventData = { type, participantName, timestamp: Date.now() };
      if (detail != null) eventData.detail = detail;
      try {
        await push(ref(db, `sessions/${sessionId}/events`), eventData);
      } catch {
        // Activity log is non-critical — silently ignore Firebase errors
      }
    },
    [sessionId],
  );

  // Set participant status to SPECTATING — watching the map without sharing location.
  // No location, ETA, or polyline data is written. Logs a "spectating" event.
  const setSpectating = useCallback(
    async (participantId, participantName) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          status: STATUS.SPECTATING,
        },
      );
      await logEvent("spectating", participantName);
    },
    [sessionId, logEvent],
  );

  // Reset participant from SPECTATING back to NOT_STARTED so they can pick a
  // travel mode and tap "I'm Leaving Now". Logs a "stopped_spectating" event.
  const exitSpectating = useCallback(
    async (participantId, participantName) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        {
          status: STATUS.NOT_STARTED,
        },
      );
      await logEvent("stopped_spectating", participantName);
    },
    [sessionId, logEvent],
  );

  // Remove the participant's node entirely — used by "Leave Meetup".
  // Other clients receive a Firebase onValue snapshot that no longer includes
  // this participant, so their map pins and ETA rows disappear automatically.
  const leaveSession = useCallback(
    async (participantId) => {
      await remove(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
      );
    },
    [sessionId],
  );

  return {
    session,
    loading,
    error,
    joinSession,
    startTrip,
    updateRoute,
    switchTravelMode,
    bumpETA,
    updateLocation,
    updateStatus,
    updateStatusEmoji,
    markArrivedManually,
    endSession,
    leaveSession,
    updateNotes,
    updateKeepVisible,
    logEvent,
    setSpectating,
    exitSpectating,
  };
}
