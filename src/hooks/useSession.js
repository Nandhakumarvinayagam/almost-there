import { useEffect, useRef, useState, useCallback } from "react";
import {
  ref,
  onValue,
  set,
  update,
  remove,
  get,
  push,
  runTransaction,
} from "firebase/database";
import { db, whenAuthReady } from "../utils/firebase";
import { SESSION_STATUS, SESSION_TTL, STATUS } from "../config/constants";
import { generateSessionId } from "../utils/sessionId";
import { normalizeSession } from "../utils/normalizers";
import { computeHeadcountDelta } from "../utils/headcount";
import { getHistory } from "../utils/sessionHistory";

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
 * @param {number}  [params.expectedCount]    - Optional expected guest count (2–20)
 * @param {number}  [params.scheduledTime]    - Future Unix timestamp (ms); shifts expiresAt
 * @param {object}  [params.theme]            - Social Edition: { color, emoji, style }
 * @param {object}  [params.logistics]        - Social Edition: { dressCode, food, parking, registry }
 * @param {object}  [params.poll]             - Social Edition: { question, options: { [id]: { text, votes } } }
 * @returns {Promise<string>} The generated 6-char session code
 */
export async function createSession({
  destination,
  hostId,
  hostSecretHash = null,
  hostName,
  nickname,
  notes,
  arrivalRadius = 100,
  expectedCount,
  scheduledTime,
  theme,
  logistics,
  poll,
  stops,
  avatarId,
}) {
  const sessionId = generateSessionId();
  const now = Date.now();

  const cleanedNickname = (nickname ?? "").trim();
  const trimmedNotes = (notes ?? "").trim() || null;

  const sessionData = {
    destination,
    hostId,
    hostSecretHash,
    status: SESSION_STATUS.ACTIVE,
    // Social Edition state machine: scheduled sessions start in lobby, not on map.
    // normalizeSession defaults missing state to 'active' for legacy sessions.
    state: scheduledTime ? 'scheduled' : 'active',
    createdAt: now,
    expiresAt: scheduledTime ? scheduledTime + SESSION_TTL : now + SESSION_TTL,
    arrivalRadius,
    // Host is automatically 'going'; headcount starts at 1.
    headcount: 1,
    ...(cleanedNickname.length > 0 && { nickname: cleanedNickname }),
    ...(trimmedNotes && { notes: trimmedNotes }),
    ...(scheduledTime && { scheduledTime }),
    ...(expectedCount != null && { expectedCount }),
    // Social Edition fields
    theme: theme || { color: '#0066CC', emoji: '📍', style: 'classic' },
    permissions: { coHosts: {} },
    ...(logistics && Object.keys(logistics).length > 0 && { logistics }),
    ...(poll && { poll }),
    ...(stops && stops.length > 0 && { stops }),
    participants: {
      [hostId]: {
        name: hostName,
        location: null,
        eta: null,
        lastUpdated: now,
        status: STATUS.NOT_STARTED,
        rsvpStatus: 'going',
        plusOnes: 0,
        visibility: 'visible',
        ...(avatarId != null && { avatarId }),
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

  // Wait for anonymous auth to complete before starting any Firebase listeners.
  // All security rules require auth != null, so listeners started before auth
  // resolves will receive PERMISSION_DENIED and fail silently.
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    whenAuthReady.then(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!sessionId || !authReady) return;

    const sessionRef = ref(db, `sessions/${sessionId}`);
    const unsubscribe = onValue(
      sessionRef,
      (snapshot) => {
        setLoading(false);
        if (!snapshot.exists()) {
          setError("not-found");
          return;
        }
        setSession(normalizeSession(snapshot.val()));
      },
      (err) => {
        setLoading(false);
        // PERMISSION_DENIED fires when the current user is in blockedUsers.
        // Surface this as a distinct error so the UI can show "You've been removed."
        if (err?.code === 'PERMISSION_DENIED') {
          setError('permission-denied');
        } else {
          setError("load-failed");
        }
      },
    );

    return () => unsubscribe();
  }, [sessionId, authReady]);

  // --- Section 4, Rule 4: Headcount Migration-on-Read ---
  // If headcount is missing (null) on a legacy session, compute it once from
  // participants and write it back via runTransaction. The guard ref ensures
  // this runs at most once per session load even across re-renders.
  // runTransaction's callback returns the current value unchanged if another
  // client already wrote a number — preventing double-writes in race conditions.
  const hasMigrated = useRef(false);

  useEffect(() => {
    if (!sessionId || !session || hasMigrated.current) return;
    if (session.headcount !== null) return; // Already has a count — skip

    hasMigrated.current = true;

    const migrate = async () => {
      try {
        const participantsSnap = await get(
          ref(db, `sessions/${sessionId}/participants`),
        );
        const participants = participantsSnap.val() || {};

        // Sum: each 'going' participant counts as 1 + their plusOnes.
        // Legacy participants without rsvpStatus default to 'going' (Section 4, Rule 5).
        let computed = 0;
        Object.values(participants).forEach((p) => {
          const status = p.rsvpStatus || "going";
          if (status === "going") {
            computed += 1 + (p.plusOnes || 0);
          }
        });

        const headcountRef = ref(db, `sessions/${sessionId}/headcount`);
        await runTransaction(headcountRef, (current) => {
          // If another client already wrote a value, keep theirs
          if (current !== null) return current;
          return computed;
        });
      } catch (err) {
        console.error("Headcount migration failed:", err);
        // Non-fatal — the UI can fall back to computing on-the-fly
      }
    };

    migrate();
  }, [sessionId, session]);

  // --- Section 1 / A.6: Ghost Transition ---
  // If the session is in 'scheduled' state and scheduledTime has passed, ANY
  // client auto-activates it. The write is idempotent — all clients write the
  // same 'active' value — so no transaction is needed (last-write-wins is fine).
  // A fixed activity-feed key prevents duplicate "Meetup is live!" entries when
  // multiple clients trigger the transition simultaneously (set() with the same
  // key is an upsert; push() would create N entries).
  const hasTriggeredGhost = useRef(false);

  useEffect(() => {
    if (!sessionId || !session || hasTriggeredGhost.current) return;
    if (session.state !== 'scheduled') return;
    if (!session.scheduledTime) return;
    if (Date.now() <= session.scheduledTime) return;

    hasTriggeredGhost.current = true;

    const activate = async () => {
      try {
        // Idempotent — no transaction needed
        await set(ref(db, `sessions/${sessionId}/state`), 'active');
        // Fixed key prevents duplicate entries from simultaneous clients.
        // ActivityFeed.jsx must listen to child_changed as well as child_added
        // so other clients' listeners see this when the key is overwritten.
        await set(
          ref(db, `sessions/${sessionId}/activityFeed/state_scheduled_to_active`),
          {
            type: 'state',
            userId: 'system',
            text: 'The meetup is now live! 🟢',
            timestamp: Date.now(),
          },
        );
      } catch (err) {
        // If the write fails (e.g. security rule not yet deployed), the session
        // stays as 'scheduled' and the next client load will retry.
        console.error('Ghost transition failed:', err);
      }
    };

    activate();
  }, [sessionId, session]);

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

  // Social Edition: join a scheduled session with RSVP status + plus-ones.
  // Writes the participant node, updates the headcount counter via transaction,
  // and appends an activity feed entry — all three in sequence.
  //
  // Uses update() (not set()) so a future status-change call can merge fields
  // without overwriting other data. Non-atomic: if the headcount transaction
  // fails after the participant write, headcount stays off by the delta until
  // the next migration-on-read. Acceptable for V1.
  //
  // Reference: Plan v5, Sections 5 and 9
  const joinWithRSVP = useCallback(
    async (participantId, name, colorIndex, rsvpStatus, plusOnes, visibility = 'visible', avatarId = null) => {
      const now = Date.now();

      const participantData = {
        name,
        colorIndex: typeof colorIndex === 'number' ? colorIndex : 0,
        location: null,
        eta: null,
        lastUpdated: now,
        status: STATUS.NOT_STARTED,
        rsvpStatus,
        plusOnes,
        visibility,
      };
      if (avatarId != null) participantData.avatarId = avatarId;

      await update(ref(db, `sessions/${sessionId}/participants/${participantId}`), participantData);

      const delta = computeHeadcountDelta({
        oldStatus: null,
        newStatus: rsvpStatus,
        newPlusOnes: plusOnes,
      });
      if (delta !== 0) {
        const headcountRef = ref(db, `sessions/${sessionId}/headcount`);
        await runTransaction(headcountRef, (current) => (current || 0) + delta);
      }

      const statusLabel =
        rsvpStatus === 'going' ? 'Going' :
        rsvpStatus === 'maybe' ? 'Maybe' : "Can't Go";
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: 'rsvp',
        userId: participantId,
        text: `${name} RSVP'd ${statusLabel}`,
        timestamp: now,
      });
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

  // Host-only: mark the session as completed.
  // Sets both legacy `status` (backward compat) and Social Edition `state`.
  // Writes an activity feed entry: "The meetup has ended 🏁" (Plan v5, Section 10).
  const endSession = useCallback(async () => {
    await update(ref(db, `sessions/${sessionId}`), {
      status: SESSION_STATUS.COMPLETED,
      state: 'completed',
    });
    // Fixed key prevents duplicate entries if called concurrently
    await set(
      ref(db, `sessions/${sessionId}/activityFeed/state_active_to_completed`),
      {
        type: 'state',
        userId: 'system',
        text: 'The meetup has ended 🏁',
        timestamp: Date.now(),
      },
    );
  }, [sessionId]);

  // Write (or clear) the current participant's highlight memory.
  // Phase 4, Plan v5: each guest submits a one-line text or URL stored as
  // participants/{id}/highlightMemory. Displayed in the SessionRecap scrollable list.
  const saveHighlightMemory = useCallback(
    async (participantId, text) => {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      await update(ref(db, `sessions/${sessionId}/participants/${participantId}`), {
        highlightMemory: trimmed || null,
      });
    },
    [sessionId],
  );

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

  // Toggle the "Who's Nearby" flag for the current participant (Plan v5, Phase 3).
  // Manual opt-in — writes nearbyStatus: true/false to the participant node.
  // Not GPS-based; the participant self-reports that they are close to the venue.
  const toggleNearby = useCallback(
    async (participantId, nearbyStatus) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        { nearbyStatus },
      );
    },
    [sessionId],
  );

  // Toggle hidden/visible mode for current participant (Section 11, Plan v5).
  // 'hidden' → name appears as "Anonymous Guest", no map pin or ETA for others.
  // 'visible' → normal display (default).
  const toggleVisibility = useCallback(
    async (participantId, visibility) => {
      await update(
        ref(db, `sessions/${sessionId}/participants/${participantId}`),
        { visibility },
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

  // Update a participant's RSVP status and/or plus-ones.
  // Called when a Maybe/Can't-Go user taps "Change to Going to Share Location"
  // or when RSVP status is changed after the initial join.
  //
  // CRITICAL: Uses update() — NEVER set() — to preserve all other participant
  // fields (customResponses, guestNote, myReactions, pollVote, etc.).
  //
  // Reference: Plan v5, Sections 5, 8, 9 (RSVP Update Handler pattern, A.4)
  const updateRSVP = useCallback(
    async (participantId, {
      oldStatus,
      newStatus,
      oldPlusOnes = 0,
      newPlusOnes = 0,
      participantName,
      isHidden = false,
    }) => {
      // Step 1: Update participant node — preserves all other fields
      await update(ref(db, `sessions/${sessionId}/participants/${participantId}`), {
        rsvpStatus: newStatus,
        plusOnes: newPlusOnes,
      });

      // Step 2: Headcount delta via transaction
      const delta = computeHeadcountDelta({ oldStatus, newStatus, oldPlusOnes, newPlusOnes });
      if (delta !== 0) {
        await runTransaction(
          ref(db, `sessions/${sessionId}/headcount`),
          (current) => (current || 0) + delta,
        );
      }

      // Step 3: Activity feed entry
      const displayName = isHidden ? 'Someone' : participantName;
      const statusLabel =
        newStatus === 'going' ? 'Going' :
        newStatus === 'maybe' ? 'Maybe' : "Can't Go";
      const text = oldStatus
        ? `${displayName} is now ${statusLabel}`
        : `${displayName} RSVP'd ${statusLabel}`;
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: oldStatus ? 'rsvp_change' : 'rsvp',
        userId: participantId,
        text,
        timestamp: Date.now(),
      });
    },
    [sessionId],
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

  // Host/co-host: permanently remove a participant.
  //
  // Sequence (Plan v5, Section 7):
  //   1. Write blockedUsers/{uid}: true — prevents rejoin and triggers
  //      PERMISSION_DENIED on the kicked user's active Firebase listener.
  //   2. Remove the participant node — erases name, RSVP, location, poll vote, etc.
  //   3. Decrement headcount via runTransaction if they were 'going'.
  //   4. Push activity feed entry { type: 'kick' }.
  //
  // Non-atomic: if a step fails after step 1, the user is blocked but their
  // participant node may briefly linger. Acceptable for V1 — the block is critical.
  // Poll vote counts and reactions are intentionally NOT rolled back (Section 7).
  const kickParticipant = useCallback(
    async (targetParticipantId, targetName, targetRsvpStatus, targetPlusOnes) => {
      // Step 1: Block
      await set(
        ref(db, `sessions/${sessionId}/blockedUsers/${targetParticipantId}`),
        true,
      );

      // Step 2: Delete participant node
      await remove(
        ref(db, `sessions/${sessionId}/participants/${targetParticipantId}`),
      );

      // Step 3: Decrement headcount if they were going
      const delta = computeHeadcountDelta({
        oldStatus: targetRsvpStatus,
        newStatus: null,
        oldPlusOnes: targetPlusOnes,
        isKick: true,
      });
      if (delta !== 0) {
        await runTransaction(
          ref(db, `sessions/${sessionId}/headcount`),
          (current) => Math.max(0, (current || 0) + delta),
        );
      }

      // Step 4: Activity feed
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: 'kick',
        userId: 'system',
        text: `${targetName} was removed by the host`,
        timestamp: Date.now(),
      });
    },
    [sessionId],
  );

  // Promote a participant to co-host. Host-only action.
  const promoteCoHost = useCallback(
    async (targetUid, targetName) => {
      await update(ref(db, `sessions/${sessionId}/permissions/coHosts`), {
        [targetUid]: true,
      });
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: 'cohost_promote',
        userId: 'system',
        text: `${targetName} was promoted to co-host`,
        timestamp: Date.now(),
      });
    },
    [sessionId],
  );

  // Remove co-host status from a participant. Host-only action.
  const demoteCoHost = useCallback(
    async (targetUid, targetName) => {
      await remove(ref(db, `sessions/${sessionId}/permissions/coHosts/${targetUid}`));
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: 'cohost_demote',
        userId: 'system',
        text: `${targetName} is no longer a co-host`,
        timestamp: Date.now(),
      });
    },
    [sessionId],
  );

  // Host recovery: add the current user as a co-host after verifying the recovery PIN.
  //
  // The security rule for permissions allows any authenticated user to add ONLY
  // THEMSELVES as a co-host (self-add clause, Plan v5 Section 6). The PIN check
  // is client-side: SHA-256 hash of the entered PIN is compared against
  // session.hostSecretHash. crypto.subtle.digest is async and may take a few hundred
  // ms on older mobile devices — callers should show a loading state.
  //
  // Returns { success: true } on match.
  // Returns { success: false, error } on failure:
  //   'no_hash'     — host never set a recovery PIN
  //   'wrong_pin'   — hash mismatch
  //   'write_failed' — Firebase write rejected (rules or network)
  const reclaimHost = useCallback(
    async (currentParticipantId, pin) => {
      const storedHash = session?.hostSecretHash;
      if (!storedHash) return { success: false, error: 'no_hash' };

      try {
        const hashBuffer = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(pin),
        );
        const enteredHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        if (enteredHash !== storedHash) {
          return { success: false, error: 'wrong_pin' };
        }

        await update(ref(db, `sessions/${sessionId}/permissions/coHosts`), {
          [currentParticipantId]: true,
        });
        return { success: true };
      } catch {
        return { success: false, error: 'write_failed' };
      }
    },
    [sessionId, session?.hostSecretHash],
  );

  // Record a poll vote for the current participant.
  //
  // Sequence (plan v5, Section 9):
  //   1. update() participant { pollVote: optionId } — single writer, no transaction needed.
  //      The Firebase security rule (!data.exists() on pollVote) prevents double-voting
  //      at the DB level; the UI gate (disabled when myVote truthy) enforces it client-side.
  //   2. runTransaction() increments poll/options/{optionId}/votes — concurrent writers possible.
  //   3. push() activity feed entry with type 'poll'.
  const votePoll = useCallback(
    async (participantId, optionId, displayName) => {
      // Step 1: record the vote choice — if this fails, throw so UI lets user retry
      await update(ref(db, `sessions/${sessionId}/participants/${participantId}`), {
        pollVote: optionId,
      });

      // Step 2: increment vote count — non-critical if this fails (choice is saved)
      try {
        await runTransaction(
          ref(db, `sessions/${sessionId}/poll/options/${optionId}/votes`),
          (current) => (current || 0) + 1,
        );
      } catch (err) {
        console.error('votePoll: failed to increment vote count', err);
      }

      // Step 3: activity feed — non-critical
      try {
        await push(ref(db, `sessions/${sessionId}/activityFeed`), {
          type: 'poll',
          userId: participantId,
          text: `${displayName} voted on the poll`,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('votePoll: failed to push activity feed', err);
      }
    },
    [sessionId],
  );

  // Toggle an emoji reaction on a logistics card.
  //
  // Toggle logic (plan v5, Section 9):
  //   Key format: `{logisticKey}_{emoji}` stored in participant.myReactions.
  //   If NOT reacted: write myReactions key → runTransaction() increment reactions counter.
  //   If ALREADY reacted: clear myReactions key → runTransaction() decrement with floor 0.
  //   Max +1 per user per emoji per card (prevents spam; highlighted state mirrors DB truth).
  //
  // update() with null removes the key in Firebase RTDB — no separate remove() call needed.
  const toggleReaction = useCallback(
    async (participantId, logisticKey, emoji, myReactions) => {
      const reactionKey = `${logisticKey}_${emoji}`;
      const hasReacted = !!myReactions?.[reactionKey];
      const reactionCountRef = ref(
        db,
        `sessions/${sessionId}/reactions/${logisticKey}/${emoji}`,
      );

      if (!hasReacted) {
        await update(
          ref(db, `sessions/${sessionId}/participants/${participantId}/myReactions`),
          { [reactionKey]: true },
        );
        await runTransaction(reactionCountRef, (current) => (current || 0) + 1);
      } else {
        await update(
          ref(db, `sessions/${sessionId}/participants/${participantId}/myReactions`),
          { [reactionKey]: null }, // null removes the key in RTDB update()
        );
        await runTransaction(reactionCountRef, (current) =>
          Math.max(0, (current || 0) - 1),
        );
      }
    },
    [sessionId],
  );

  return {
    session,
    loading,
    error,
    joinSession,
    joinWithRSVP,
    updateRSVP,
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
    kickParticipant,
    promoteCoHost,
    demoteCoHost,
    reclaimHost,
    updateNotes,
    updateKeepVisible,
    toggleNearby,
    toggleVisibility,
    logEvent,
    setSpectating,
    exitSpectating,
    votePoll,
    toggleReaction,
    saveHighlightMemory,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL Cleanup (Phase 4, Plan v5 Section 12)
// ─────────────────────────────────────────────────────────────────────────────

const TTL_DRAFT_MS            = 7  * 24 * 60 * 60 * 1000; // 7 days
const TTL_SCHEDULED_OVERDUE_MS = 48 * 60 * 60 * 1000;      // 48 h past scheduledTime
const TTL_ACTIVE_STALE_MS     = 24 * 60 * 60 * 1000;       // 24 h no location update
const TTL_COMPLETED_MS        = 30 * 24 * 60 * 60 * 1000;  // 30 days

/**
 * Client-side TTL cleanup for sessions this device hosted.
 * Runs once per app load (ref-guarded). Iterates the localStorage session
 * history (wasHost entries), fetches each session from Firebase, and applies
 * the TTL rules from Plan v5, Section 12:
 *
 *   Draft      → delete after 7 days of inactivity
 *   Scheduled  → delete if 48 h past scheduledTime and still 'scheduled'
 *   Active     → transition to 'completed' if no location updates in 24 h
 *   Completed  → delete if past expiresAt OR 30 days old
 */
export function useTTLCleanup() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function runCleanup() {
      const hostedEntries = getHistory().filter((e) => e.wasHost);

      for (const entry of hostedEntries) {
        try {
          const sessionRef = ref(db, `sessions/${entry.sessionId}`);
          const snap = await get(sessionRef);
          if (!snap.exists()) continue;

          const session = normalizeSession(snap.val());

          const now = Date.now();

          if (session.state === "draft") {
            // Draft: delete if inactive for 7 days
            if (now - (session.createdAt || 0) > TTL_DRAFT_MS) {
              await remove(sessionRef);
            }
          } else if (session.state === "scheduled") {
            // Scheduled: delete if 48 h past scheduled start and never activated
            if (
              session.scheduledTime &&
              now - session.scheduledTime > TTL_SCHEDULED_OVERDUE_MS
            ) {
              await remove(sessionRef);
            }
          } else if (
            session.state === "active" ||
            session.status === SESSION_STATUS.ACTIVE
          ) {
            // Active: auto-complete if no location updates in 24 h
            const participantsSnap = await get(
              ref(db, `sessions/${entry.sessionId}/participants`)
            );
            const participantValues = Object.values(
              participantsSnap.val() || {}
            );
            const lastUpdate = participantValues.reduce(
              (max, p) => Math.max(max, p.lastUpdated || 0),
              session.createdAt || 0
            );
            if (now - lastUpdate > TTL_ACTIVE_STALE_MS) {
              await update(sessionRef, {
                state:  "completed",
                status: SESSION_STATUS.COMPLETED,
              });
            }
          } else if (
            session.state === "completed" ||
            session.status === SESSION_STATUS.COMPLETED
          ) {
            // Completed: delete if past expiresAt OR older than 30 days
            const expiresAt =
              session.expiresAt ||
              (session.createdAt || 0) + TTL_COMPLETED_MS;
            if (
              now > expiresAt ||
              now - (session.createdAt || 0) > TTL_COMPLETED_MS
            ) {
              await remove(sessionRef);
            }
          }
        } catch (err) {
          console.error(`TTL cleanup failed for ${entry.sessionId}:`, err);
        }
      }
    }

    runCleanup();
  }, []);
}
