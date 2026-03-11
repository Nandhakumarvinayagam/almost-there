import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLoadScript, GoogleMap, OverlayView } from '@react-google-maps/api';
import { ref as dbRef, onValue } from 'firebase/database';
import { db } from '../utils/firebase';
import { useSession } from '../hooks/useSession';
import { useGeolocation } from '../hooks/useGeolocation';
import { getETAWithRoute } from '../utils/directions';
import { SESSION_STATUS, STATUS, MODE_SWITCH_COOLDOWN_MS, ARRIVAL_PIN_HIDE_DELAY_MS, PARTICIPANT_COLORS, STALE_THRESHOLD } from '../config/constants';
import { DARK_MAP_STYLES } from '../config/mapStyles';
import { useColorScheme } from '../hooks/useColorScheme';
import JoinPrompt from '../components/JoinPrompt';
import Lobby from '../components/Lobby';
import ETAPanel from '../components/ETAPanel';
import { triggerShare } from '../components/ShareLink';
import ParticipantMarker from '../components/ParticipantMarker';
import RecenterButton from '../components/RecenterButton';
import DestinationMarker from '../components/DestinationMarker';
import RoutePolyline from '../components/RoutePolyline';
import LocationPermissionPrompt from '../components/LocationPermissionPrompt';
import Toast from '../components/Toast';
import SessionRecap from '../components/SessionRecap';
import { saveSession } from '../utils/sessionHistory';
import { normalizeParticipant } from '../utils/normalizers';
import { getNavigationURL } from '../utils/navigation';
import { copyToClipboard } from '../utils/clipboard';
import { useToast } from '../hooks/useToast';
import { haversineDistance } from '../utils/geo';
import { getColorPreference, setColorPreference } from '../utils/colorPrefs';
import { haptic } from '../utils/haptic';
import { generateGoogleCalendarURL, generateICSBlob } from '../utils/calendar';
import { hexToRgb, getContrastTextColor } from '../utils/theme';
import MatIcon from '../components/MatIcon';
import { auth, whenAuthReady } from '../utils/firebase';

// Stable reference — must be outside component to prevent re-renders
const LIBRARIES = ['places'];

// Human-readable labels for each travel mode (used in activity feed events)
const MODE_LABELS = { DRIVING: 'Drive', BICYCLING: 'Bike', TRANSIT: 'Transit', WALKING: 'Walk' };

/** Format a countdown duration (ms) as a human-readable string. */
function formatCountdown(ms) {
  if (ms <= 0) return '0s';
  const totalSecs = Math.ceil(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m >= 10) return `${m}m`;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

// Travel mode options shown in the start-trip bar
const TRAVEL_MODE_OPTIONS = [
  { value: 'DRIVING',   icon: <MatIcon name="directions_car"     size={22} />, label: 'Drive'   },
  { value: 'BICYCLING', icon: <MatIcon name="directions_bike"    size={22} />, label: 'Bike'    },
  { value: 'TRANSIT',   icon: <MatIcon name="directions_transit" size={22} />, label: 'Transit' },
  { value: 'WALKING',   icon: <MatIcon name="directions_walk"    size={22} />, label: 'Walk'    },
];

function generateParticipantId() {
  return Math.random().toString(36).slice(2, 11);
}

/** Reactive wrapper around window.matchMedia — uses CSS media query for correctness. */
function useMatchMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** Share / upload SVG — used for the accent share button in the header. */
function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

/** Navigation arrow SVG — opens Apple Maps / Google Maps deep link. */
function NavigateIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}


/**
 * Returns true if newBounds fits inside 1.5× the map's current viewport.
 * Used to decide between panToBounds (small move) and fitBounds (large jump).
 */
function isBoundsNearby(map, newBounds) {
  if (!map || !newBounds) return false;
  try {
    const current = map.getBounds();
    if (!current) return false;
    const sw = current.getSouthWest();
    const ne = current.getNorthEast();
    const dLat = (ne.lat() - sw.lat()) * 0.25; // 0.25 each side → 1.5× total
    const dLng = (ne.lng() - sw.lng()) * 0.25;
    const expanded = new window.google.maps.LatLngBounds(
      { lat: sw.lat() - dLat, lng: sw.lng() - dLng },
      { lat: ne.lat() + dLat, lng: ne.lng() + dLng }
    );
    return expanded.contains(newBounds.getSouthWest()) && expanded.contains(newBounds.getNorthEast());
  } catch {
    return false;
  }
}

export default function Session() {
  const { id: sessionId } = useParams();
  const colorScheme = useColorScheme();

  // true when viewport is >= 768px — map + ETAPanel switch to side-by-side layout
  const isSidebar = useMatchMedia('(min-width: 768px)');

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const navigate = useNavigate();

  const { session, loading, error, joinWithRSVP, updateRSVP, startTrip, updateRoute, switchTravelMode, bumpETA, updateLocation, updateStatus, updateStatusEmoji, markArrivedManually, endSession, leaveSession, kickParticipant, promoteCoHost, demoteCoHost, reclaimHost, updateNotes, updateKeepVisible, toggleNearby, toggleVisibility, logEvent, setSpectating, exitSpectating, votePoll, toggleReaction, saveHighlightMemory } =
    useSession(sessionId);

  // ---- Participant identity ----
  const [participantId, setParticipantId] = useState(
    () => sessionStorage.getItem(`participant_${sessionId}`) ?? null
  );

  // Track the Firebase anonymous auth UID separately from participantId.
  // participantId comes from sessionStorage and is null until the user joins,
  // but authUid persists across tab closures (Firebase stores it in IndexedDB).
  // This lets us recognize returning hosts even before they re-join.
  const [authUid, setAuthUid] = useState(() => auth.currentUser?.uid ?? null);

  // Once auth resolves, validate the stored participantId and capture authUid.
  // If it was a legacy random ID (pre-auth), clear it so the user re-joins
  // with their stable auth UID, matching the security rule auth.uid === $participantId.
  useEffect(() => {
    whenAuthReady.then((user) => {
      if (!user) return;
      setAuthUid(user.uid);
      const stored = sessionStorage.getItem(`participant_${sessionId}`);
      if (stored && stored !== user.uid) {
        sessionStorage.removeItem(`participant_${sessionId}`);
        setParticipantId(null);
      }
    });
  }, [sessionId]);
  const [joining, setJoining] = useState(false);

  // ---- Toast notifications (Features 6 & 7) ----
  const { toast, showToast } = useToast();
  const [addrCopyBounce, setAddrCopyBounce] = useState(false);

  // ---- Participant join-count celebration ----
  const [hasCelebratedJoinCount, setHasCelebratedJoinCount] = useState(false);
  const [joinCountBanner, setJoinCountBanner] = useState(false);

  // ---- Leave meetup ----
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isLeaving, setIsLeaving]           = useState(false);
  const [showKebabMenu, setShowKebabMenu]   = useState(false);
  const kebabRef = useRef(null);

  // ---- Scheduled time countdown ----
  const [timeLeft, setTimeLeft] = useState(null); // null = not yet initialized
  const [leaveEarly, setLeaveEarly] = useState(false);
  const countdownStartedRef = useRef(false);
  const hasVibratedRef = useRef(false);

  // CRITICAL: cleanup clears the interval on unmount to prevent timer leaks.
  useEffect(() => {
    const scheduledTime = session?.scheduledTime;
    if (!scheduledTime) return;
    const remaining = scheduledTime - Date.now();
    if (remaining <= 0) return; // Already past when page loaded — don't show countdown

    countdownStartedRef.current = true;
    setTimeLeft(Math.max(0, remaining));

    const interval = setInterval(() => {
      const left = scheduledTime - Date.now();
      if (left <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
        // Fire haptic exactly once when the countdown expires.
        // Guard with a ref so this never runs on subsequent re-renders.
        if (!hasVibratedRef.current) {
          hasVibratedRef.current = true;
          haptic(50);
        }
      } else {
        setTimeLeft(left);
      }
    }, 1_000);

    return () => clearInterval(interval);
  }, [session?.scheduledTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close kebab dropdown when the user taps anywhere outside it.
  // CRITICAL: return cleanup to remove listeners on unmount / menu close.
  useEffect(() => {
    if (!showKebabMenu) return;
    const handleOutside = (e) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setShowKebabMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showKebabMenu]);

  // ---- Start-trip loading phases ----
  // null | 'location' | 'route'
  const [startingPhase, setStartingPhase] = useState(null);

  // ---- Travel mode ----
  const [travelMode, setTravelMode] = useState('DRIVING');
  const [modeError, setModeError] = useState(null);
  const travelModeRef = useRef('DRIVING');
  // Ref for session stops — avoids stale closures in memoized callbacks
  const sessionStopsRef = useRef([]);
  useEffect(() => {
    sessionStopsRef.current = (session?.stops || []).filter(s => s.lat != null);
  }, [session?.stops]);

  // ---- Location permission ----
  const [geoError, setGeoError] = useState(null);
  const [showPreAsk, setShowPreAsk] = useState(false);
  const [locPromptVisible, setLocPromptVisible] = useState(false);

  useEffect(() => {
    if (geoError) setLocPromptVisible(true);
  }, [geoError]);

  // ---- Pre-trip background geolocation ----
  // Fetch the user's location in the background as soon as they join so the
  // map can pan to include them and the "I'm Leaving Now" button can be
  // enabled with a ready animation.
  const [preUserLocation,  setPreUserLocation]  = useState(null);
  const [preLocating,      setPreLocating]      = useState(false);
  const [locationJustReady, setLocationJustReady] = useState(false);
  const preLocationAttemptedRef = useRef(false);

  // ---- Map tile loading ----
  const [mapTilesLoaded, setMapTilesLoaded] = useState(false);

  // ---- Stale-check tick ----
  // CRITICAL: return clearInterval so the timer is cleaned up on unmount.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // ---- Derived state ----
  const isExpired = session ? now > session.expiresAt : false;
  const isEnded = session?.status === SESSION_STATUS.COMPLETED;
  // Check both participantId (sessionStorage-based, set after join) and authUid
  // (Firebase auth, persists across tab closures). This ensures the host is
  // recognized even before re-joining (e.g. opened session in a new tab).
  const isHost = (!!participantId && session?.hostId === participantId)
    || (!!authUid && session?.hostId === authUid);
  const isCoHost = (!!participantId && !!session?.permissions?.coHosts?.[participantId])
    || (!!authUid && !!session?.permissions?.coHosts?.[authUid]);
  const destination = session?.destination ?? null;
  const participants = useMemo(
    () =>
      session?.participants
        ? Object.entries(session.participants).map(([id, p]) => [id, normalizeParticipant(p)])
        : [],
    [session?.participants]
  );

  // ---- Trip state ----
  const myParticipant = normalizeParticipant(session?.participants?.[participantId] ?? null);
  const participantStatus = myParticipant?.status ?? STATUS.NOT_STARTED;
  // tripStarted: true for any status except NOT_STARTED — hides the pre-trip bar.
  // SPECTATING is intentionally included so spectators also dismiss the pre-trip bar.
  const tripStarted = participantStatus !== STATUS.NOT_STARTED;
  const isSpectating = participantStatus === STATUS.SPECTATING;
  const routePolyline = myParticipant?.routePolyline ?? null;
  const arrived = participantStatus === STATUS.ARRIVED;
  const isPaused = participantStatus === STATUS.PAUSED;

  // Feature 2 — "I'm Here" button: show when user is en-route / almost-there
  // and within 2× the session's arrival radius of the destination.
  const showImHereButton = useMemo(() => {
    if (!participantId || !destination || !myParticipant?.location) return false;
    if (participantStatus !== STATUS.EN_ROUTE && participantStatus !== STATUS.ALMOST_THERE) return false;
    const dist   = haversineDistance(myParticipant.location, destination);
    const radius = session?.arrivalRadius ?? 100;
    return dist <= 2 * radius;
  }, [participantId, destination, myParticipant?.location, myParticipant?.location?.lat, myParticipant?.location?.lng, participantStatus, session?.arrivalRadius]); // eslint-disable-line react-hooks/exhaustive-deps
  travelModeRef.current = myParticipant?.travelMode ?? travelMode;
  // Only active travelers count for "everyone's here" — spectators and not-started participants
  // must not block the celebration from firing.
  const travelers = participants.filter(
    ([, p]) => p.status !== STATUS.NOT_STARTED && p.status !== STATUS.SPECTATING
  );
  const allArrived = travelers.length > 0 && travelers.every(([, p]) => p.status === STATUS.ARRIVED);

  // ---- Participant count + celebration ----
  const participantCount = participants.length;
  const expectedCount = session?.expectedCount ?? null;

  // Fire once when count reaches expectedCount; guard prevents re-trigger on leave+rejoin.
  // CRITICAL: return cleanup to clear the auto-dismiss timer on unmount / deps change.
  useEffect(() => {
    if (!expectedCount || hasCelebratedJoinCount || participantCount < expectedCount) return;
    setHasCelebratedJoinCount(true);
    setJoinCountBanner(true);
    const t = setTimeout(() => setJoinCountBanner(false), 3_000);
    return () => clearTimeout(t);
  }, [participantCount, expectedCount, hasCelebratedJoinCount]);

  // ---- Calendar params (for scheduled meetup export) ----
  const calendarParams = useMemo(() => {
    if (!session?.scheduledTime || !destination) return null;
    const title = session?.nickname
      ? `${session.nickname} — Almost There`
      : `Meetup at ${destination.name || destination.address || 'destination'}`;
    // Build RSVP summary for calendar description
    let rsvpSummary;
    if (participants.length > 0) {
      let going = 0, maybe = 0, cantGo = 0;
      for (const [, p] of participants) {
        const r = p.rsvpStatus ?? 'going';
        if (r === 'going')        going += 1 + (p.plusOnes ?? 0);
        else if (r === 'maybe')   maybe++;
        else if (r === 'cant-go') cantGo++;
      }
      const parts = [`${going} going`];
      if (maybe > 0)  parts.push(`${maybe} maybe`);
      if (cantGo > 0) parts.push(`${cantGo} can't go`);
      rsvpSummary = parts.join(', ');
    }
    return {
      title,
      startTime: session.scheduledTime,
      location: destination.address || destination.name,
      description: session?.notes || undefined,
      rsvpSummary,
      sessionURL: `${window.location.origin}/session/${sessionId}`,
    };
  }, [session?.scheduledTime, session?.nickname, session?.notes, destination, sessionId, participants]);

  // ---- Countdown derived state ----
  // showCountdownBanner stays true even after timeLeft hits 0 (so the parent
  // div is never unmounted on expiry — only swaps children per the spec).
  const showCountdownBanner =
    countdownStartedRef.current &&
    timeLeft !== null &&
    !leaveEarly &&
    participantStatus === STATUS.NOT_STARTED;

  const isTimeUp = timeLeft === 0;

  // Pre-trip bar: hidden while an active countdown is showing but NOT yet expired.
  // Once the countdown expires (isTimeUp) or the user clicks "Leave Early", it
  // becomes visible so the normal flow (mode picker → "I'm Leaving Now") resumes.
  const showPreTripBar = !!(participantId && !tripStarted && (!showCountdownBanner || isTimeUp));

  // ---- Save session to history when it ends or expires ----
  const historySavedRef = useRef(false);
  useEffect(() => {
    if (!session || !(isEnded || isExpired) || historySavedRef.current) return;
    historySavedRef.current = true;
    const participantNames = Object.values(session.participants ?? {})
      .map((p) => p.name)
      .filter(Boolean);
    saveSession({
      sessionId,
      destination: session.destination,
      nickname: session.nickname ?? null,
      date: Date.now(),
      participants: participantNames,
      wasHost: isHost,
      scheduledTime: session.scheduledTime ?? null,
      expiresAt: session.expiresAt ?? null,
      // Store social fields for host so "Clone This Meetup" works from the home screen
      ...(isHost && session.theme        && { theme:        session.theme        }),
      ...(isHost && session.logistics    && { logistics:    session.logistics     }),
    });
  }, [isEnded, isExpired, session, sessionId, isHost]);

  // ---- Offline detection (browser network) ----
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ---- Feature 5: Firebase connection status ----
  // Tracks Firebase's own WebSocket state (distinct from browser network).
  // A 3-second grace period prevents a false "connection lost" flash on initial load
  // before Firebase has had a chance to establish its first connection.
  const [firebaseConnected, setFirebaseConnected] = useState(true);
  const [backOnlineFlash, setBackOnlineFlash]     = useState(false);
  const connGraceRef    = useRef(false); // becomes true after 3s
  const connTimerRef    = useRef(null);
  const prevFirebaseConnRef = useRef(true);

  useEffect(() => {
    const graceTimer = setTimeout(() => { connGraceRef.current = true; }, 3_000);
    const connRef = dbRef(db, '.info/connected');
    const unsub = onValue(connRef, (snap) => {
      const isConn = snap.val() === true;
      if (!connGraceRef.current) {
        // Still in grace window — record state but don't update UI
        prevFirebaseConnRef.current = isConn;
        return;
      }
      const wasConn = prevFirebaseConnRef.current;
      prevFirebaseConnRef.current = isConn;
      setFirebaseConnected(isConn);
      if (isConn && !wasConn) {
        // Just reconnected — flash "Back online" for 2s
        setBackOnlineFlash(true);
        clearTimeout(connTimerRef.current);
        connTimerRef.current = setTimeout(() => setBackOnlineFlash(false), 2_000);
      }
    });
    return () => {
      clearTimeout(graceTimer);
      clearTimeout(connTimerRef.current);
      unsub();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Feature 1: "Almost there" broadcast toast ----
  // Fires once per participant per session load when their status transitions to
  // ALMOST_THERE (detected via the real-time Firebase listener, so ALL participants
  // in the session see the notification, not just the person who is almost there).
  const almostThereNotifiedRef = useRef(new Set());
  const [accentToast, setAccentToast] = useState(null);
  const accentToastTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(accentToastTimerRef.current), []);

  useEffect(() => {
    if (!session?.participants) return;
    for (const [id, p] of Object.entries(session.participants)) {
      if (p.status === STATUS.ALMOST_THERE && !almostThereNotifiedRef.current.has(id)) {
        almostThereNotifiedRef.current.add(id);
        setAccentToast(`${p.name} is almost there! 🎉`);
        clearTimeout(accentToastTimerRef.current);
        accentToastTimerRef.current = setTimeout(() => setAccentToast(null), 3_500);
        haptic([100, 50, 100]); // double-buzz on Android; no-op on iOS/desktop
      }
    }
  }, [session?.participants]);

  // ---- Feature 5c: GPS freshness tracking ----
  // lastGeoUpdate is set on every onUpdate callback from useGeolocation.
  // If more than STALE_THRESHOLD ms pass without a fresh position, we show
  // a "GPS signal lost" warning in the current user's ETA card.
  const [lastGeoUpdate, setLastGeoUpdate] = useState(null);
  // GPS lost: geolocation hasn't fired in STALE_THRESHOLD ms
  // Spectators never share location, so skip the check for them.
  const gpsLost = tripStarted && !arrived && !isPaused && !isSpectating &&
    lastGeoUpdate !== null && (now - lastGeoUpdate > STALE_THRESHOLD);

  // ---- Navigate to destination ----
  const [navTipVisible, setNavTipVisible] = useState(false);
  const navTipTimerRef = useRef(null);
  // CRITICAL: clear the auto-dismiss timer on unmount
  useEffect(() => () => clearTimeout(navTipTimerRef.current), []);

  const handleNavigate = useCallback(() => {
    const mode = myParticipant?.travelMode ?? 'DRIVING';
    window.open(getNavigationURL(destination.lat, destination.lng, mode), '_blank');
    if (!localStorage.getItem('hasSeenNavTip')) {
      localStorage.setItem('hasSeenNavTip', 'true');
      setNavTipVisible(true);
      clearTimeout(navTipTimerRef.current);
      navTipTimerRef.current = setTimeout(() => setNavTipVisible(false), 4_000);
    }
  }, [destination, myParticipant]);

  // ---- Copy destination address (Feature 6) ----
  const handleCopyAddress = useCallback(async () => {
    const text = destination?.address || destination?.name;
    if (!text) return;
    setAddrCopyBounce(true);
    setTimeout(() => setAddrCopyBounce(false), 200);
    try {
      await copyToClipboard(text);
      haptic(50);
      showToast('Address copied!');
    } catch {
      showToast("Couldn't copy — long-press to copy manually");
    }
  }, [destination, showToast]);

  // ---- Copy session code (Feature 7) ----
  const handleCopyCode = useCallback(async () => {
    try {
      await copyToClipboard(sessionId);
      haptic(50);
      showToast('Code copied!');
    } catch {
      showToast("Couldn't copy");
    }
  }, [sessionId, showToast]);

  // ---- Calendar export handlers (for scheduled meetups) ----
  const handleGoogleCalendar = useCallback(() => {
    if (!calendarParams) return;
    window.open(generateGoogleCalendarURL(calendarParams), '_blank', 'noopener,noreferrer');
  }, [calendarParams]);

  const handleDownloadICS = useCallback(() => {
    if (!calendarParams) return;
    const blob = generateICSBlob(calendarParams);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'meetup.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, [calendarParams]);

  // ---- Screen Wake Lock ----
  const wakeLockRef = useRef(null);
  useEffect(() => {
    if (!participantId || isEnded || isExpired || isPaused || isSpectating) return;
    if (!('wakeLock' in navigator)) return;

    async function acquire() {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch {
        // Silently ignore — battery saver mode or unsupported browser
      }
    }

    acquire();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [participantId, isEnded, isExpired, isPaused, isSpectating]);

  // ---- Background pre-trip geolocation ----
  // Fetch location as soon as the user joins so the map can show both
  // destination + user, and so the "I'm Leaving Now" button can be
  // enabled with a ready animation once location resolves.
  // 'Maybe' location gate (Section 8, Plan v5): do NOT pre-fetch location for
  // Maybe/Can't Go participants — they have no intention of sharing location.
  // When they tap "Change to Going", rsvpStatus changes → this effect re-runs
  // (preLocationAttemptedRef is still false) and geolocation kicks in.
  useEffect(() => {
    if (!participantId || tripStarted || preLocationAttemptedRef.current) return;
    if (!navigator.geolocation) return;
    if (myParticipant?.rsvpStatus === 'maybe' || myParticipant?.rsvpStatus === 'cant-go') return;
    preLocationAttemptedRef.current = true;
    setPreLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPreUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPreLocating(false);
      },
      () => setPreLocating(false),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }, [participantId, tripStarted, myParticipant?.rsvpStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Brief scale-in animation on the button when location first resolves.
  useEffect(() => {
    if (preLocating || !preUserLocation) return;
    setLocationJustReady(true);
    const t = setTimeout(() => setLocationJustReady(false), 400);
    return () => clearTimeout(t);
  }, [preLocating, preUserLocation]);

  // ---- Wire geolocation → Firebase ----
  const handleGeoUpdate = useCallback(
    (loc) => {
      if (participantId) updateLocation(participantId, loc);
      setLastGeoUpdate(Date.now()); // Feature 5c: track freshness for GPS-lost indicator
    },
    [participantId, updateLocation]
  );

  // ---- Panel height tracking (for map padding + floating control positioning) ----
  // panelHeightRef: current visible panel height in px (not state — avoids re-render churn)
  // panelAtFull: boolean state for opacity transition of floating controls
  const panelHeightRef = useRef(160); // default peek height
  const [panelAtFull, setPanelAtFull] = useState(false);

  const handlePanelHeightChange = useCallback((heightPx, isFullSnap) => {
    panelHeightRef.current = heightPx;
    setPanelAtFull(isFullSnap);
  }, []);

  // ---- Map instance + smart viewport fit ----
  const mapRef = useRef(null);
  const hasDoneInitialFitRef = useRef(false);
  const prevFitStateRef = useRef(null); // { count, positions[] }
  // Ref-gating: prevent auto-fit from fighting a manual user pan.
  const userHasInteracted = useRef(false);
  const isProgrammaticMove = useRef(false);
  // Debounce guard: timestamp of last fitBounds call; prevents rapid-fire re-fits.
  const lastFitBoundsTime = useRef(0);

  // 'overview' fits all active participants; 'follow-me' pans to current user
  const [mapMode, setMapMode] = useState('overview');

  const handleMapLoad = useCallback((map) => {
    mapRef.current = map;
    map.addListener('dragstart', () => {
      if (!isProgrammaticMove.current) {
        userHasInteracted.current = true;
      }
    });
  }, []);

  // Participants with locations count for auto-fit bounds.
  // Include PAUSED and recently-ARRIVED so the map stays stable on status changes.
  const activeForBounds = useMemo(() => {
    const now = Date.now();
    return participants.filter(([, p]) => {
      if (!p.location) return false;
      if (p.status === STATUS.EN_ROUTE || p.status === STATUS.ALMOST_THERE || p.status === STATUS.PAUSED) {
        return true;
      }
      if (p.status === STATUS.ARRIVED) {
        const arrivedRecently = p.lastUpdated && (now - p.lastUpdated) < ARRIVAL_PIN_HIDE_DELAY_MS;
        return p.keepVisible || arrivedRecently;
      }
      return false;
    });
  }, [participants]);

  // Spatial fingerprint: a stable string that only changes when participant
  // locations, statuses, or IDs change. Non-spatial fields (statusEmoji, name,
  // reactions, pollVote, etc.) don't affect it, so they won't trigger fitBounds.
  const spatialFingerprint = useMemo(() => {
    if (!participants || participants.length === 0) return '[]';
    return JSON.stringify(
      participants.map(([id, p]) => [
        id,
        // Round to 4 dp (~11m precision) to absorb micro-GPS jitter (3–10m).
        // This prevents a tiny location drift coinciding with a non-spatial write
        // (e.g. statusEmoji) from changing the fingerprint and triggering a re-fit.
        p.location?.lat != null ? Math.round(p.location.lat * 10000) / 10000 : null,
        p.location?.lng != null ? Math.round(p.location.lng * 10000) / 10000 : null,
        p.status ?? null,
      ])
    );
  }, [participants]);

  // participantsRef: stable ref so fitMapBounds doesn't need 'participants' in its
  // useCallback deps. Firebase onValue creates new object references on every update
  // (including activityFeed, reactions, headcount) — keeping 'participants' in the deps
  // would cause fitMapBounds to get a new reference on every update, which in turn
  // would cause the smart fit effect to re-run unnecessarily.
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  const fitMapBounds = useCallback(() => {
    if (!mapRef.current || !destination) return;
    // Don't fight a manual user pan — only the Re-center button overrides this.
    if (userHasInteracted.current) return;
    // Debounce: skip if fitBounds ran within the last 2 seconds.
    if (Date.now() - lastFitBoundsTime.current < 2000) return;
    lastFitBoundsTime.current = Date.now();

    // Dynamic bottom padding based on current panel height.
    // Math.min safeguard: prevents fatal "Padding exceeds map dimensions" error
    // when the panel is at Full on a small phone.
    const panelH = panelHeightRef.current;
    const padding = {
      top:    80,
      right:  80,
      bottom: Math.min(panelH + 20, window.innerHeight - 150),
      left:   80,
    };

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend({ lat: destination.lat, lng: destination.lng });
    // Prefer active participants; fall back to all participants for initial fit.
    // Use participantsRef so this callback stays stable across non-position updates.
    const group = activeForBounds.length > 0 ? activeForBounds : participantsRef.current;
    let extraPoints = 0;
    group.forEach(([, p]) => { if (p.location) { bounds.extend(p.location); extraPoints++; } });

    // No participants have a location yet — center on destination at a sensible zoom.
    // Always set zoom 14 so pressing Recenter while everyone is still "not-started"
    // snaps back to a useful view rather than leaving the user at a stale zoom level.
    if (extraPoints === 0) {
      mapRef.current.setCenter({ lat: destination.lat, lng: destination.lng });
      mapRef.current.setZoom(14);
      hasDoneInitialFitRef.current = true;
      return;
    }

    if (bounds.isEmpty()) return;

    // Mark as programmatic so the dragstart listener doesn't count this as
    // a user interaction. Reset via idle event + 500ms fallback (the fallback
    // handles the case where fitBounds doesn't change the viewport, meaning
    // the 'idle' event never fires and isProgrammaticMove would stay stuck).
    isProgrammaticMove.current = true;
    window.google.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
      isProgrammaticMove.current = false;
    });
    setTimeout(() => { isProgrammaticMove.current = false; }, 500);

    if (hasDoneInitialFitRef.current && isBoundsNearby(mapRef.current, bounds)) {
      mapRef.current.panToBounds(bounds, padding);
    } else {
      mapRef.current.fitBounds(bounds, padding);
    }
  }, [destination, activeForBounds]); // 'participants' removed — use participantsRef instead

  // fitMapBoundsRef: lets the smart fit effect call the latest fitMapBounds without
  // including it in the effect's dependency array. Without this, every Firebase update
  // (activityFeed, reactions, etc.) would cause fitMapBounds to get a new reference,
  // which would cause the smart fit effect to re-run and potentially fire fitBounds()
  // on every update — causing the unintended zoom-out bug.
  const fitMapBoundsRef = useRef(fitMapBounds);
  fitMapBoundsRef.current = fitMapBounds;

  // Smart fit: refit when spatial data (locations, statuses, participant IDs) changes.
  // spatialFingerprint only changes on actual movement/join/leave/status changes —
  // non-spatial writes like statusEmoji, name, reactions won't trigger this effect.
  useEffect(() => {
    if (!mapRef.current || !destination || mapMode !== 'overview') return;
    fitMapBoundsRef.current();
    hasDoneInitialFitRef.current = true;
  }, [destination, spatialFingerprint, mapMode]); // spatialFingerprint replaces activeForBounds

  // Trip-started auto-lock: once the current user's trip begins, lock the map so
  // GPS drift doesn't cause unwanted re-fits during active navigation.
  // The isProgrammaticMove guard prevents this from firing during a recenter operation
  // (which would cancel the recenter fitBounds before it executes).
  useEffect(() => {
    if (
      myParticipant?.status &&
      myParticipant.status !== 'not-started' &&
      !isProgrammaticMove.current
    ) {
      userHasInteracted.current = true;
    }
  }, [myParticipant?.status]);

  // Follow Me: pan to current user on every location update.
  // For spectators (no location), fall back to centering on the destination.
  useEffect(() => {
    if (mapMode !== 'follow-me' || !mapRef.current) return;
    const me = participants.find(([id]) => id === participantId);
    if (me?.[1]?.location) {
      mapRef.current.panTo(me[1].location);
    } else if (isSpectating && destination) {
      mapRef.current.panTo({ lat: destination.lat, lng: destination.lng });
    }
  }, [mapMode, participants, participantId, isSpectating, destination]);

  // Pan map to show both destination and pre-fetched user location.
  useEffect(() => {
    if (!preUserLocation || !mapRef.current || !destination) return;
    const panelH = panelHeightRef.current;
    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend({ lat: destination.lat, lng: destination.lng });
    bounds.extend(preUserLocation);
    mapRef.current.fitBounds(bounds, {
      top:    80,
      right:  80,
      bottom: Math.min(panelH + 20, window.innerHeight - 150),
      left:   80,
    });
  }, [preUserLocation, destination]);

  // Trigger map resize when the layout switches between mobile column and desktop sidebar.
  // This forces Google Maps to recalculate its container size.
  useEffect(() => {
    if (mapRef.current && window.google?.maps?.event) {
      window.google.maps.event.trigger(mapRef.current, 'resize');
    }
  }, [isSidebar]);

  // ---- Handlers ----
  const handleJoin = useCallback(
    async (name, rsvpStatus = 'going', plusOnes = 0, visibility = 'visible', avatarId = null) => {
      setJoining(true);
      // Use the stable anonymous auth UID so Firebase ownership rules work.
      // Fall back to the legacy random generator only if auth hasn't resolved yet.
      const pid = auth.currentUser?.uid ?? generateParticipantId();
      try {
        // Determine color: prefer localStorage hint, avoid colors already taken
        const takenIndices = new Set(
          participants.map(([, p]) => p.colorIndex).filter((ci) => typeof ci === 'number')
        );
        const preferred = getColorPreference(name);
        let colorIndex;
        if (typeof preferred === 'number' && !takenIndices.has(preferred % PARTICIPANT_COLORS.length)) {
          colorIndex = preferred % PARTICIPANT_COLORS.length;
        } else {
          // Find first free slot
          let slot = 0;
          while (takenIndices.has(slot % PARTICIPANT_COLORS.length)) slot++;
          colorIndex = slot % PARTICIPANT_COLORS.length;
        }
        setColorPreference(name, colorIndex);
        // joinWithRSVP writes rsvpStatus, plusOnes, headcount delta, and activityFeed entry.
        // logEvent still writes to the separate 'events' node for the ETA panel activity tab.
        await joinWithRSVP(pid, name, colorIndex, rsvpStatus, plusOnes, visibility, avatarId);
        sessionStorage.setItem(`participant_${sessionId}`, pid);
        sessionStorage.setItem(`name_${sessionId}`, name);
        setParticipantId(pid);
        logEvent('joined', name);
      } finally {
        setJoining(false);
      }
    },
    [joinWithRSVP, sessionId, participants, logEvent]
  );

  // Lobby join: used when session.state === 'scheduled'.
  // Reuses the same color-selection logic as handleJoin, but calls joinWithRSVP
  // so rsvpStatus, plusOnes, headcount transaction, and activity feed entry are
  // all written in one go. After joining, the user sees the lobby with their
  // RSVP status shown. When the session later transitions to 'active', the
  // existing participantId in sessionStorage reconnects them to the map view.
  const handleLobbyJoin = useCallback(
    async (name, rsvpStatus, plusOnes, visibility = 'visible', avatarId = null) => {
      setJoining(true);
      const pid = auth.currentUser?.uid ?? generateParticipantId();
      try {
        const takenIndices = new Set(
          participants.map(([, p]) => p.colorIndex).filter((ci) => typeof ci === 'number')
        );
        const preferred = getColorPreference(name);
        let colorIndex;
        if (typeof preferred === 'number' && !takenIndices.has(preferred % PARTICIPANT_COLORS.length)) {
          colorIndex = preferred % PARTICIPANT_COLORS.length;
        } else {
          let slot = 0;
          while (takenIndices.has(slot % PARTICIPANT_COLORS.length)) slot++;
          colorIndex = slot % PARTICIPANT_COLORS.length;
        }
        setColorPreference(name, colorIndex);
        await joinWithRSVP(pid, name, colorIndex, rsvpStatus, plusOnes, visibility, avatarId);
        sessionStorage.setItem(`participant_${sessionId}`, pid);
        sessionStorage.setItem(`name_${sessionId}`, name);
        setParticipantId(pid);
      } finally {
        setJoining(false);
      }
    },
    [joinWithRSVP, sessionId, participants]
  );

  const handleEndSession = useCallback(async () => {
    if (!window.confirm('End this meetup for everyone?')) return;
    await endSession();
  }, [endSession]);

  // Toggle between overview (fit all active) and follow-me (pan to current user)
  const handleRecenterToggle = useCallback(() => {
    setMapMode((prev) => {
      const next = prev === 'overview' ? 'follow-me' : 'overview';
      if (next === 'overview') {
        // Mark as programmatic BEFORE clearing userHasInteracted, so the
        // trip-started auto-lock effect doesn't immediately re-lock the map
        // and cancel the recenter fitBounds (ping-pong prevention).
        // The isProgrammaticMove flag is cleared by the 'idle' event and
        // 500ms fallback inside fitMapBounds, after which the auto-lock re-engages.
        isProgrammaticMove.current = true;
        userHasInteracted.current = false;
        lastFitBoundsTime.current = 0; // reset debounce so recenter fires immediately
      }
      return next;
    });
  }, []);

  const handleLeaveConfirm = useCallback(async () => {
    if (!participantId || isLeaving) return;
    setIsLeaving(true);
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    try {
      await leaveSession(participantId);
    } catch {
      // Firebase error — still redirect so the user isn't stuck
    }
    sessionStorage.removeItem(`participant_${sessionId}`);
    sessionStorage.removeItem(`name_${sessionId}`);
    navigate('/');
  }, [participantId, isLeaving, leaveSession, sessionId, navigate]);

  // ---- ETA recalculation ----
  const recalculateETA = useCallback(
    async (location, { resetBump = false } = {}) => {
      if (!participantId || !destination) return;
      try {
        const result = await getETAWithRoute(location, destination, travelModeRef.current, sessionStopsRef.current);
        const routeData = {
          location,
          eta: result.eta,
          expectedArrivalTime: result.transitArrivalTime ?? (Date.now() + result.eta * 1000),
          routePolyline: result.routePolyline,
          routeDistance: result.routeDistance ?? null,
          routeDistanceMeters: result.routeDistanceMeters ?? null,
          resetBump,
        };
        if (result.transitInfo != null) routeData.transitInfo = result.transitInfo;
        await updateRoute(participantId, routeData);
      } catch {
        // Silently ignore — stale ETA stays until next successful call
      }
    },
    [participantId, destination, updateRoute]
  );

  const handleOffRoute = useCallback(
    (location) => { recalculateETA(location); },
    [recalculateETA]
  );

  // ---- Arrival callbacks ----
  const handleAlmostThere = useCallback(() => {
    if (!participantId) return;
    updateStatus(participantId, STATUS.ALMOST_THERE);
    logEvent('almost_there', myParticipant?.name);
  }, [participantId, updateStatus, logEvent, myParticipant?.name]);

  const handleArrival = useCallback(() => {
    if (!participantId) return;
    updateStatus(participantId, STATUS.ARRIVED);
    haptic([100, 50, 100]);
    logEvent('arrived', myParticipant?.name);
  }, [participantId, updateStatus, logEvent, myParticipant?.name]);

  // Feature 2 — manual "I'm Here" override
  const handleManualArrival = useCallback(() => {
    if (!participantId) return;
    markArrivedManually(participantId);
    haptic([100, 50, 100]);
    logEvent('arrived', myParticipant?.name);
  }, [participantId, markArrivedManually, logEvent, myParticipant?.name]);

  const handleRecalculateETA = useCallback(async () => {
    if (!participantId || !destination) return;
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        })
      );
      await recalculateETA({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      // Location denied or timed out — ignore
    }
  }, [participantId, destination, recalculateETA]);

  // ---- Wire geolocation → Firebase ----
  useGeolocation({
    active: !!participantId && !geoError && !isEnded && !isExpired && tripStarted && !arrived && !isPaused && !isSpectating,
    participantId,
    destination,
    routePolyline,
    arrivalRadius: session?.arrivalRadius ?? null,
    onUpdate: handleGeoUpdate,
    onAlmostThere: handleAlmostThere,
    onArrival: handleArrival,
    onOffRoute: handleOffRoute,
    onError: setGeoError,
  });

  // ---- Start trip ----
  const handleStartTrip = useCallback(async () => {
    if (!participantId || !destination) return;
    setModeError(null);
    try {
      // Use pre-fetched location if available — avoids a second permission prompt
      let location;
      if (preUserLocation) {
        location = preUserLocation;
        setStartingPhase('route');
      } else {
        setStartingPhase('location');
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
          })
        );
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }

      let eta = null;
      let tripPolyline = null;
      let transitArrivalTime = null;
      let transitInfo = null;
      let routeDistance = null;
      let routeDistanceMeters = null;

      setStartingPhase('route');
      try {
        const result = await getETAWithRoute(location, destination, travelMode, sessionStopsRef.current);
        eta = result.eta;
        tripPolyline = result.routePolyline;
        transitArrivalTime = result.transitArrivalTime ?? null;
        transitInfo = result.transitInfo ?? null;
        routeDistance = result.routeDistance ?? null;
        routeDistanceMeters = result.routeDistanceMeters ?? null;
      } catch (err) {
        if (err.code === 'ZERO_RESULTS') {
          setModeError('Directions not available for this mode. Try another.');
          setStartingPhase(null);
          return;
        }
        // Other API errors — start trip without a route
      }

      await startTrip(participantId, {
        location,
        eta,
        expectedArrivalTime: transitArrivalTime ?? (eta != null ? Date.now() + eta * 1000 : null),
        routePolyline: tripPolyline,
        travelMode,
        transitInfo,
        routeDistance,
        routeDistanceMeters,
      });
      haptic(50);
      logEvent('trip_started', myParticipant?.name, travelMode);
    } catch (err) {
      if (err.code === 1 /* PERMISSION_DENIED */) {
        setGeoError('denied');
        setLocPromptVisible(true);
      } else {
        console.warn('Start trip failed:', err.message ?? err);
      }
    } finally {
      setStartingPhase(null);
    }
  }, [participantId, destination, startTrip, travelMode, preUserLocation, logEvent, myParticipant?.name]);

  // ---- Mode switch cooldown ----
  const [modeSwitchCooldownUntil, setModeSwitchCooldownUntil] = useState(0);

  // ---- Pause / Resume location sharing ----
  const handlePause = useCallback(async () => {
    if (!participantId) return;
    await updateStatus(participantId, STATUS.PAUSED);
    logEvent('paused', myParticipant?.name);
  }, [participantId, updateStatus, logEvent, myParticipant?.name]);

  const handleResume = useCallback(async () => {
    if (!participantId) return;
    await updateStatus(participantId, STATUS.EN_ROUTE);
    logEvent('resumed', myParticipant?.name);
    handleRecalculateETA();
  }, [participantId, updateStatus, logEvent, myParticipant?.name, handleRecalculateETA]);

  // ---- Quick ETA Bump ----
  const handleBumpETA = useCallback(
    async (mins) => {
      if (!participantId) return;
      await bumpETA(participantId, mins);
      haptic(50);
      logEvent('eta_bumped', myParticipant?.name, `+${mins} min`);
    },
    [participantId, bumpETA, logEvent, myParticipant?.name]
  );

  const handleBumpRecalculate = useCallback(async () => {
    if (!participantId || !destination) return;
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        })
      );
      await recalculateETA(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        { resetBump: true }
      );
    } catch {
      // Location denied or timed out — ignore
    }
  }, [participantId, destination, recalculateETA]);

  // ---- Mid-trip travel mode switch ----
  const handleSwitchTravelMode = useCallback(
    async (newMode) => {
      if (!participantId || !destination) return;
      const oldMode = travelModeRef.current ?? 'DRIVING';
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
          })
        );
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const result = await getETAWithRoute(location, destination, newMode, sessionStopsRef.current);
        await switchTravelMode(participantId, {
          travelMode: newMode,
          eta: result.eta,
          expectedArrivalTime: result.transitArrivalTime ?? (Date.now() + result.eta * 1000),
          routePolyline: result.routePolyline,
          transitInfo: result.transitInfo ?? null,
          routeDistance: result.routeDistance ?? null,
          routeDistanceMeters: result.routeDistanceMeters ?? null,
        });
        travelModeRef.current = newMode;
        setModeSwitchCooldownUntil(Date.now() + MODE_SWITCH_COOLDOWN_MS);
        haptic(50);
        logEvent('mode_switched', myParticipant?.name, `${MODE_LABELS[oldMode]} → ${MODE_LABELS[newMode]}`);
      } catch {
        showToast('Could not switch mode — try again');
      }
    },
    [participantId, destination, switchTravelMode, logEvent, myParticipant?.name]
  );

  // ---- Spectator mode ----
  const handleSetSpectating = useCallback(async () => {
    if (!participantId) return;
    await setSpectating(participantId, myParticipant?.name);
  }, [participantId, setSpectating, myParticipant?.name]);

  const handleExitSpectating = useCallback(async () => {
    if (!participantId) return;
    await exitSpectating(participantId, myParticipant?.name);
  }, [participantId, exitSpectating, myParticipant?.name]);

  // 'Maybe' location gate (Section 8, Plan v5):
  // Converts a Maybe/Can't-Go participant to Going so location sharing can start.
  // Uses update() to preserve all other participant fields (customResponses, etc.).
  // Headcount delta and activityFeed entry are written inside updateRSVP.
  const handleChangeToGoing = useCallback(async () => {
    if (!participantId || !myParticipant) return;
    await updateRSVP(participantId, {
      oldStatus: myParticipant.rsvpStatus,
      newStatus: 'going',
      oldPlusOnes: myParticipant.plusOnes,
      newPlusOnes: myParticipant.plusOnes,
      participantName: myParticipant.name,
      isHidden: myParticipant.visibility === 'hidden',
    });
  }, [participantId, myParticipant?.rsvpStatus, myParticipant?.plusOnes, myParticipant?.name, myParticipant?.visibility, updateRSVP]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Pre-ask gate for start trip ----
  const handleStartTripClick = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeoError('unavailable');
      setLocPromptVisible(true);
      return;
    }
    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' });
      if (perm?.state === 'denied') {
        setGeoError('denied');
        setLocPromptVisible(true);
        return;
      }
      if (perm?.state === 'prompt') {
        setShowPreAsk(true);
        return;
      }
    } catch {
      // Permissions API not available — proceed
    }
    handleStartTrip();
  }, [handleStartTrip]);

  const handleLocPromptDismiss = useCallback(() => {
    setShowPreAsk(false);
    setLocPromptVisible(false);
  }, []);

  const handleLocPermissionConfirm = useCallback(() => {
    setShowPreAsk(false);
    handleStartTrip();
  }, [handleStartTrip]);

  // ---- Header: share meetup link (accent button, Row 1) ----
  const handleHeaderShare = useCallback(() => {
    const meetupName = session?.nickname || destination?.name;
    triggerShare(sessionId, meetupName, destination, showToast);
  }, [sessionId, session?.nickname, destination, showToast]);

  // ---- Derived: what to show in LocationPermissionPrompt ----
  const locPromptState = showPreAsk ? 'pre-ask' : (locPromptVisible ? geoError : null);

  // ---- Render guards ----
  if (loadError) {
    return (
      <div className="loading">Failed to load Google Maps. Check your API key.</div>
    );
  }

  if (!isLoaded || loading) {
    return (
      <div className="session-skeleton" aria-busy="true" aria-label="Loading session">
        <div className="skeleton-header">
          <div className="skeleton-dest">
            <div className="skeleton-bar skeleton-bar-icon" />
            <div className="skeleton-bar skeleton-bar-dest" />
          </div>
          <div className="skeleton-header-actions">
            <div className="skeleton-bar skeleton-bar-btn" />
          </div>
        </div>
        <div className="skeleton-map" aria-hidden="true" />
        <div className="skeleton-panel">
          <div className="skeleton-panel-handle" />
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton-item">
              <div className="skeleton-avatar" />
              <div className="skeleton-lines">
                <div className="skeleton-line skeleton-line-name" />
                <div className="skeleton-line skeleton-line-status" />
              </div>
              <div className="skeleton-bar skeleton-bar-eta" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error === 'not-found') {
    return (
      <div className="session-message">
        <h2>Session not found</h2>
        <p>This meetup link is invalid or has been deleted.</p>
        <a href="/" className="btn btn-primary">Go home</a>
      </div>
    );
  }

  // PERMISSION_DENIED fires when blockedUsers contains this user's UID.
  // Also catch it via the session data for cases where rules aren't yet enforced
  // (security rules use auth.uid; blockedUsers key uses participantId).
  const isKicked =
    error === 'permission-denied' ||
    (!!participantId && !!session?.blockedUsers?.[participantId]);

  if (isKicked) {
    return (
      <div className="session-message">
        <h2>You've been removed from this session.</h2>
        <a href="/" className="btn btn-primary">Go Home</a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-message">
        <h2>Something went wrong</h2>
        <p>Couldn't load the session. Check your connection and try again.</p>
        <a href="/" className="btn btn-primary">Go home</a>
      </div>
    );
  }

  // Expired sessions get a full-screen static message (no recap data is meaningful
  // because the TTL could fire long after the session was active).
  if (isExpired) {
    return (
      <div className="session-message">
        <div className="session-ended-icon"><MatIcon name="schedule" size={48} /></div>
        <h2>Meetup expired</h2>
        <p>This meetup link has expired (2-hour limit).</p>
        <a href="/" className="btn btn-primary">Start a new one</a>
      </div>
    );
  }
  // State-machine routing (Section 1, Plan v5):
  //   'scheduled' → Lobby (Phase 2 — placeholder for now)
  //   'active'    → Map (existing behavior, falls through to main render below)
  //   'completed' → SessionRecap overlay rendered inside main render
  // Default 'active' (from normalizeSession) ensures legacy sessions always
  // reach the map render. The ghost transition in useSession has already fired
  // by this point if scheduledTime has passed, so a briefly-visible placeholder
  // is the worst-case UX — the Firebase onValue update will flip state to 'active'
  // and React will re-render into the map view within milliseconds.
  if (session?.state === 'scheduled') {
    return (
      <Lobby
        session={session}
        sessionId={sessionId}
        participantId={participantId}
        isHost={isHost}
        isCoHost={isCoHost}
        onJoin={handleLobbyJoin}
        joining={joining}
        votePoll={votePoll}
        toggleReaction={toggleReaction}
        kickParticipant={kickParticipant}
        reclaimHost={reclaimHost}
        showToast={showToast}
        onToggleVisibility={(v) => { if (participantId) toggleVisibility(participantId, v); }}
        onToggleNearby={(v) => { if (participantId) toggleNearby(participantId, v); }}
      />
    );
  }

  // isEnded (host-ended) is handled below as a SessionRecap overlay so every
  // participant sees the podium/stats before being redirected home.

  // ────────────────────────────────────────────────────────────────
  // Main session render
  // ────────────────────────────────────────────────────────────────
  // Base blue — color theming removed; buttons that sit on the accent color need white text
  const themeColor = '#0066CC';

  return (
    <div className="session">

      {/* ── Header bar — normal-flow flex item (not absolute) ── */}
      <header className="session-header">
        {/* Inner wrapper caps content at 1200px on ultra-wide displays */}
        <div className="session-header-inner">

          {/* ── Single row: truncating text block + icon buttons ── */}
          <div className="session-header-row1">

            {/* Left: meetup title + destination address, truncate gracefully */}
            <div className="session-header-text">
              <div
                className="session-header-title"
                title={session?.nickname || destination?.name || destination?.address || 'Destination'}
              >
                {session?.nickname || destination?.name || destination?.address || 'Destination'}
              </div>
              {/* Destination address sub-line — tap to copy; hidden if same as title */}
              {(() => {
                const titleText = session?.nickname || destination?.name || destination?.address || 'Destination';
                const subText = session?.nickname
                  ? (destination?.name || destination?.address || 'Destination')
                  : (destination?.address || destination?.name || 'Destination');
                if (!destination || subText === titleText) return null;
                return (
                  <div
                    className={`session-dest-address${addrCopyBounce ? ' session-dest-address-bounce' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleCopyAddress}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopyAddress(); } }}
                    title="Tap to copy address"
                    aria-label={`${destination?.address || destination?.name || 'Destination'} — tap to copy address`}
                  >
                    {subText}
                  </div>
                );
              })()}
            </div>

            {/* Participant join count — small muted line below title/address */}
            <div className="session-join-count" aria-live="polite">
              {expectedCount
                ? `${participantCount} of ${expectedCount} joined`
                : `${participantCount} joined`}
            </div>

            {/* Group note — shown as header subtitle */}
            {session?.notes && (
              <div className="session-header-note" title={session.notes}>
                {session.notes}
              </div>
            )}

            {/* Right: icon buttons — flex-shrink: 0 so they never get pushed off-screen */}
            <div className="session-header-btns">

              {/* Navigate to destination */}
              {destination && (
                <button
                  className="header-icon-btn"
                  onClick={handleNavigate}
                  aria-label="Navigate to destination"
                >
                  <NavigateIcon />
                </button>
              )}

              {/* Share meetup link */}
              <button
                className="header-icon-btn"
                onClick={handleHeaderShare}
                aria-label="Share meetup link"
              >
                <ShareIcon />
              </button>

              {/* Kebab menu — shown to any joined participant */}
              {participantId && (
                <div className="kebab-menu" ref={kebabRef}>
                  <button
                    className="kebab-btn"
                    onClick={() => setShowKebabMenu((v) => !v)}
                    aria-label="More options"
                    aria-expanded={showKebabMenu}
                    aria-haspopup="menu"
                  >
                    <MatIcon name="more_vert" size={22} />
                  </button>
                  {showKebabMenu && (
                    <div className="kebab-dropdown" role="menu">

                      {/* Copy session code */}
                      <button
                        className="kebab-option"
                        role="menuitem"
                        onClick={() => { setShowKebabMenu(false); handleCopyCode(); }}
                      >
                        <MatIcon name="content_copy" size={20} />
                        Copy Session Code
                      </button>

                      {/* Edit Group Note — host only */}
                      {isHost && (
                        <button
                          className="kebab-option"
                          role="menuitem"
                          onClick={() => {
                            setShowKebabMenu(false);
                            const newNote = window.prompt('Group note (max 200 chars):', session?.notes || '');
                            if (newNote !== null) updateNotes(newNote.slice(0, 200));
                          }}
                        >
                          <MatIcon name="description" size={20} />
                          Edit Group Note
                        </button>
                      )}

                      {/* End Meetup — host only */}
                      {isHost && (
                        <button
                          className="kebab-option kebab-option-danger"
                          role="menuitem"
                          onClick={() => { setShowKebabMenu(false); handleEndSession(); }}
                        >
                          <MatIcon name="cancel" size={20} />
                          End Meetup
                        </button>
                      )}

                      <button
                        className="kebab-option kebab-option-danger"
                        role="menuitem"
                        onClick={() => { setShowKebabMenu(false); setShowLeaveModal(true); }}
                      >
                        <MatIcon name="logout" size={20} />
                        Leave Meetup
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </header>

      {/* ── Body: map area + ETA panel (flex row on desktop) ── */}
      <div className="session-body">

        {/* ── Map area — fills remaining space ── */}
        <div className={`session-map-wrap${panelAtFull && !isSidebar ? ' panel-at-full' : ''}`}>
          {/* Map — defaultCenter/defaultZoom show destination immediately on render;
              fitBounds overrides this once participants have locations. */}
          <GoogleMap
            mapContainerClassName="map-container"
            defaultCenter={destination ? { lat: destination.lat, lng: destination.lng } : undefined}
            defaultZoom={destination ? 14 : 4}
            onLoad={handleMapLoad}
            onTilesLoaded={() => setMapTilesLoaded(true)}
            options={{
              clickableIcons: false,
              fullscreenControl: false,
              streetViewControl: false,
              mapTypeControl: false,
              styles: colorScheme === 'dark' ? DARK_MAP_STYLES : [],
            }}
          >
            <DestinationMarker destination={destination} />

            {/* Stop markers — numbered circles at each waypoint */}
            {(session?.stops || []).filter(s => s.lat != null).map((stop, i) => (
              <OverlayView
                key={`stop-${i}`}
                position={{ lat: stop.lat, lng: stop.lng }}
                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                getPixelPositionOffset={() => ({ x: -14, y: -14 })}
              >
                <div className="stop-marker" title={stop.name || `Stop ${i + 1}`}>
                  <span className="stop-marker-number">{i + 1}</span>
                  {stop.name && <span className="stop-marker-label">{stop.name}</span>}
                </div>
              </OverlayView>
            ))}

            {participants.map(([id, p], index) => {
              // Spectators have no location or route — skip rendering entirely
              if (p.status === STATUS.SPECTATING) return null;
              // Hidden participants: no route visible to other non-host/cohost viewers
              if (p.visibility === 'hidden' && id !== participantId && !isHost && !isCoHost) return null;
              return <RoutePolyline key={`route-${id}`} participant={p} index={index} />;
            })}

            {participants.map(([id, p], index) => {
              // Spectators have no location — never render a map pin for them
              if (p.status === STATUS.SPECTATING) return null;
              // Hidden participants: no map pin for other non-host/cohost viewers
              if (p.visibility === 'hidden' && id !== participantId && !isHost && !isCoHost) return null;
              if (
                p.status === STATUS.ARRIVED &&
                !p.keepVisible &&
                now - p.lastUpdated > ARRIVAL_PIN_HIDE_DELAY_MS
              ) return null;
              // Collision avoidance: nudge label down if any earlier-indexed participant
              // is within ~50 m. Uses Haversine distance — no DOM measurements needed.
              const nudgeLabelDown = p.location != null && participants.slice(0, index).some(
                ([, other]) => other.location != null &&
                  haversineDistance(p.location, other.location) < 50
              );
              return (
                <ParticipantMarker
                  key={id}
                  participant={p}
                  index={index}
                  isCurrentUser={id === participantId}
                  isHost={id === session?.hostId}
                  nudgeLabelDown={nudgeLabelDown}
                  now={now}
                />
              );
            })}
          </GoogleMap>

          {/* Map tile loading overlay — pointer-events:none in CSS so it never
              blocks touches on the map beneath it. */}
          {!mapTilesLoaded && (
            <div className="map-tile-spinner" role="status" aria-label="Loading map">
              <div className="loading-spinner" aria-hidden="true" />
              <span className="map-tile-spinner-label">Loading map…</span>
            </div>
          )}

          {/* Pre-trip location acquiring overlay — pulsing text while geolocation resolves */}
          {showPreTripBar && preLocating && (
            <div className="pre-trip-locating-overlay" aria-live="polite">
              <span className="pre-trip-locating-text">Getting your location…</span>
            </div>
          )}

          {/* Re-center button — bottom-right, above collapsed ETA handle */}
          <RecenterButton
            mode={mapMode}
            onModeToggle={handleRecenterToggle}
          />

          {/* Status banners — stacked at top of map area */}
          <div className="session-banners">

            {/* Feature 5: Firebase WebSocket connection status — highest priority */}
            {!firebaseConnected && (
              <div className="firebase-offline-banner" role="alert" aria-live="assertive">
                <span className="firebase-conn-dot" aria-hidden="true" />
                Connection lost — reconnecting…
              </div>
            )}
            {backOnlineFlash && (
              <div className="firebase-online-banner" role="status" aria-live="polite">
                ✓ Back online
              </div>
            )}
            {!isOnline && (
              <div className="offline-banner" role="alert">
                <MatIcon name="cloud_off" size={18} />
                <span>No internet — updates are paused.</span>
              </div>
            )}

            {/* Hidden mode indicator — persistent chip when current user is hidden */}
            {participantId && myParticipant?.visibility === 'hidden' && (
              <div className="session-hidden-mode-banner" role="status">
                <MatIcon name="visibility_off" size={16} />
                <span>You're in hidden mode</span>
                <button
                  className="session-hidden-mode-toggle"
                  onClick={() => toggleVisibility(participantId, 'visible')}
                >
                  Go visible
                </button>
              </div>
            )}

            {/* ── Countdown banner — scheduled meetup ─────────────────────────
                Visible only while: scheduledTime was future on load,
                user is "not-started", and they haven't clicked "Leave Early".
                The parent div is NEVER unmounted when timeLeft hits 0 — only
                its children swap. This preserves the CSS background transition. */}
            {showCountdownBanner && (
              <div
                className={`countdown-banner${isTimeUp ? ' countdown-banner-timeup' : ''}`}
                role="status"
                aria-live="polite"
              >
                {isTimeUp ? (
                  <span className="countdown-timeup-text">Time to head out! <MatIcon name="rocket_launch" size={18} style={{ verticalAlign: 'middle' }} /></span>
                ) : (
                  <>
                    <div className="countdown-banner-row">
                      <span className="countdown-banner-label">
                        <MatIcon name="schedule" size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Meetup starts in {formatCountdown(timeLeft)}
                      </span>
                    </div>
                    <div className="countdown-calendar-btns">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleGoogleCalendar}
                      >
                        <MatIcon name="calendar_today" size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Google Calendar
                      </button>
                      <a
                        href="#"
                        download="meetup.ics"
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.preventDefault(); handleDownloadICS(); }}
                      >
                        <MatIcon name="download" size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Download .ics
                      </a>
                    </div>
                    <button
                      className="countdown-leave-early-btn"
                      onClick={() => setLeaveEarly(true)}
                    >
                      Leave early? Start now
                    </button>
                  </>
                )}
              </div>
            )}

            {navTipVisible && (
              <div
                className="nav-tip-banner"
                role="status"
                aria-live="polite"
                onClick={() => setNavTipVisible(false)}
              >
                <MatIcon name="info" size={18} /> Tip: Keep Almost There open in your browser for live tracking.
              </div>
            )}
            {allArrived && (
              <div
                className="celebration-banner"
                role="status"
                aria-live="polite"
                style={{ color: getContrastTextColor(themeColor) }}
              >
                <MatIcon name="celebration" size={20} />
                <span>Everyone's here!</span>
              </div>
            )}
            {joinCountBanner && (
              <div
                className="celebration-banner"
                role="status"
                aria-live="polite"
                style={{ background: '#16A34A', color: '#fff' }}
              >
                <MatIcon name="group" size={20} />
                <span>Everyone's joined! 🎉</span>
              </div>
            )}
          </div>

          {/* "I'm Leaving Now" bar — hidden while countdown is active; revealed
              once countdown expires (isTimeUp) or user clicks "Leave Early".
              'Maybe' location gate (Section 8, Plan v5): Maybe/Can't Go
              participants see "Change to Going to Share Location" instead of
              the travel mode selector and "I'm Leaving Now" — no location UI
              until they commit to going. */}
          {showPreTripBar && (
            <div className="start-trip-bar">
              {myParticipant && myParticipant.rsvpStatus !== 'going' ? (
                <>
                  <p className="start-trip-hint">
                    {myParticipant.rsvpStatus === 'maybe' ? "You're on the maybe list" : "You can't make it"}
                  </p>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={handleChangeToGoing}
                  >
                    Change to Going to Share Location
                  </button>
                </>
              ) : (
                <>
                  <p className="start-trip-hint">How are you getting there?</p>

                  <div className="travel-mode-selector" role="group" aria-label="Travel mode">
                    {TRAVEL_MODE_OPTIONS.map((m) => (
                      <button
                        key={m.value}
                        className={`mode-btn${travelMode === m.value ? ' mode-btn-selected' : ''}`}
                        onClick={() => { setTravelMode(m.value); setModeError(null); }}
                        aria-label={m.label}
                        aria-pressed={travelMode === m.value}
                        style={travelMode === m.value ? { color: getContrastTextColor(themeColor) } : {}}
                      >
                        <span className="mode-icon" aria-hidden="true">{m.icon}</span>
                        <span className="mode-label">{m.label}</span>
                      </button>
                    ))}
                  </div>

                  {modeError && <p className="error-msg" role="alert">{modeError}</p>}
                  <button
                    className={`btn btn-success btn-full${locationJustReady ? ' btn-location-ready' : ''}`}
                    onClick={handleStartTripClick}
                    disabled={!!startingPhase || preLocating}
                    style={{ color: getContrastTextColor(themeColor) }}
                  >
                    {startingPhase === 'location'
                      ? 'Getting your location…'
                      : startingPhase === 'route'
                        ? 'Calculating route…'
                        : "I'm Leaving Now"}
                  </button>
                  <button
                    className="btn-spectate"
                    onClick={handleSetSpectating}
                    disabled={!!startingPhase}
                  >
                    Just watching? Join as spectator
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── ETA panel — bottom sheet on mobile, sidebar on desktop ── */}
        <ETAPanel
          sessionId={sessionId}
          session={session}
          participants={participants}
          currentParticipantId={participantId}
          destination={destination}
          isSidebar={isSidebar}
          isHost={isHost}
          onPause={handlePause}
          onResume={handleResume}
          onSwitchMode={handleSwitchTravelMode}
          modeSwitchCooldownUntil={modeSwitchCooldownUntil}
          onBumpETA={handleBumpETA}
          onBumpRecalculate={handleBumpRecalculate}
          onToggleKeepVisible={(value) => {
            if (participantId) updateKeepVisible(participantId, value);
          }}
          onStatusEmoji={(emoji) => {
            if (participantId) updateStatusEmoji(participantId, emoji);
          }}
          onManualArrival={handleManualArrival}
          showImHereButton={showImHereButton}
          hostId={session?.hostId}
          isViewerHostOrCoHost={isHost || isCoHost}
          onPromoteCoHost={promoteCoHost}
          onDemoteCoHost={demoteCoHost}
          onToggleVisibility={(v) => { if (participantId) toggleVisibility(participantId, v); }}
          gpsLost={gpsLost}
          onHeightChange={!isSidebar ? handlePanelHeightChange : undefined}
          onExitSpectating={handleExitSpectating}
        />
      </div>

      {/* ── Full-screen overlays — outside session-body so they span the full viewport ── */}

      {/* Location permission prompt — pre-ask / denied / unavailable */}
      {locPromptState && participantId && (
        <LocationPermissionPrompt
          state={locPromptState}
          onRequestPermission={handleLocPermissionConfirm}
          onDismiss={handleLocPromptDismiss}
        />
      )}

      {/* Name prompt for first-time visitors */}
      {!participantId && (
        <JoinPrompt
          title="You're almost there!"
          subtitle={`Joining: ${destination.name || destination.address || 'Meetup'}`}
          onSubmit={handleJoin}
          loading={joining}
          themeColor={themeColor}
        />
      )}

      {/* Leave meetup confirmation modal */}
      {showLeaveModal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="leave-modal-title">
          <div className="prompt-card">
            <h3 id="leave-modal-title">Leave meetup?</h3>
            <p className="prompt-subtitle">Others won't see your location anymore.</p>
            {isHost && (
              <p className="prompt-subtitle">
                As the host, the meetup will continue until it expires. You can also End Meetup to stop it for everyone.
              </p>
            )}
            <div className="prompt-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setShowLeaveModal(false)}
                disabled={isLeaving}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleLeaveConfirm}
                disabled={isLeaving}
              >
                {isLeaving ? 'Leaving…' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast — copy feedback for address & session code */}
      <Toast message={toast} />

      {/* Feature 1: Accent toast — "almost there" broadcast */}
      <Toast message={accentToast} variant="accent" />

      {/* Feature 4: Session recap — shown to all participants when host ends meetup.
          Rendered as an overlay over the session so the map is still visible
          underneath and Firebase data is still accessible for the stats. */}
      {isEnded && session && (
        <SessionRecap
          session={session}
          participants={participants}
          destination={destination}
          myParticipantId={participantId}
          onSaveMemory={(text) => saveHighlightMemory(participantId, text)}
          onDone={() => navigate('/')}
          isHost={isHost}
          onClone={() => navigate('/create', { state: { cloneFrom: {
            destination:  session.destination,
            nickname:     session.nickname     ?? null,
            theme:        session.theme        ?? null,
            logistics:    session.logistics    ?? null,
          }}})}
        />
      )}
    </div>
  );
}
