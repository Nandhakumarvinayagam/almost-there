import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLoadScript, GoogleMap } from '@react-google-maps/api';
import { ref as dbRef, onValue } from 'firebase/database';
import { db } from '../utils/firebase';
import { useSession } from '../hooks/useSession';
import { useGeolocation } from '../hooks/useGeolocation';
import { getETAWithRoute } from '../utils/directions';
import { SESSION_STATUS, STATUS, MODE_SWITCH_COOLDOWN_MS, ARRIVAL_PIN_HIDE_DELAY_MS, PARTICIPANT_COLORS, STALE_THRESHOLD } from '../config/constants';
import { DARK_MAP_STYLES } from '../config/mapStyles';
import { useColorScheme } from '../hooks/useColorScheme';
import JoinPrompt from '../components/JoinPrompt';
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
import { getNavigationURL } from '../utils/navigation';
import { copyToClipboard } from '../utils/clipboard';
import { useToast } from '../hooks/useToast';
import { haversineDistance } from '../utils/geo';
import { getColorPreference, setColorPreference } from '../utils/colorPrefs';
import { haptic } from '../utils/haptic';
import { generateGoogleCalendarURL, generateICSBlob } from '../utils/calendar';
import MatIcon from '../components/MatIcon';

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


/** Outline SVG pencil icon — replaces the ✏️ emoji in the notes banner. */
function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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

  const { session, loading, error, joinSession, startTrip, updateRoute, switchTravelMode, bumpETA, updateLocation, updateStatus, updateStatusEmoji, markArrivedManually, endSession, leaveSession, updateNotes, updateKeepVisible, logEvent, setSpectating, exitSpectating } =
    useSession(sessionId);

  // ---- Participant identity ----
  const [participantId, setParticipantId] = useState(
    () => sessionStorage.getItem(`participant_${sessionId}`) ?? null
  );
  const [joining, setJoining] = useState(false);

  // ---- Toast notifications (Features 6 & 7) ----
  const { toast, showToast } = useToast();
  const [addrCopyBounce, setAddrCopyBounce] = useState(false);

  // ---- Leave meetup ----
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isLeaving, setIsLeaving]           = useState(false);
  const [showKebabMenu, setShowKebabMenu]   = useState(false);
  const kebabRef = useRef(null);

  // ---- Notes banner ----
  const [notesDismissed,       setNotesDismissed]       = useState(false);
  const [notesEditing,         setNotesEditing]         = useState(false);
  const [notesEditText,        setNotesEditText]        = useState('');
  const [notesSaving,          setNotesSaving]          = useState(false);
  // Auto-collapse: banner collapses after 5 s on mobile; once collapsed, timer doesn't restart
  const [notesAutoCollapsed,   setNotesAutoCollapsed]   = useState(false);
  const [notesHasAutocollapsed, setNotesHasAutocollapsed] = useState(false);

  // Auto-collapse timer — fires once on mobile. On desktop the CSS override keeps the banner
  // fully visible regardless of this state, so we don't need to gate it on isSidebar here.
  // CRITICAL: cleanup on unmount / deps change.
  useEffect(() => {
    if (!session?.notes || notesDismissed || notesEditing || notesHasAutocollapsed) return;
    const t = setTimeout(() => {
      setNotesAutoCollapsed(true);
      setNotesHasAutocollapsed(true);
    }, 5_000);
    return () => clearTimeout(t);
  }, [session?.notes, notesDismissed, notesEditing, notesHasAutocollapsed]);

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
  const isHost = !!participantId && session?.hostId === participantId;
  const destination = session?.destination ?? null;
  const participants = useMemo(
    () => (session?.participants ? Object.entries(session.participants) : []),
    [session?.participants]
  );

  // ---- Trip state ----
  const myParticipant = session?.participants?.[participantId] ?? null;
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

  // ---- Calendar params (for scheduled meetup export) ----
  const calendarParams = useMemo(() => {
    if (!session?.scheduledTime || !destination) return null;
    const title = session?.nickname
      ? `${session.nickname} — Almost There`
      : `Meetup at ${destination.name || destination.address || 'destination'}`;
    return {
      title,
      startTime: session.scheduledTime,
      location: destination.address || destination.name,
      description: session?.notes || undefined,
      sessionURL: `${window.location.origin}/session/${sessionId}`,
    };
  }, [session?.scheduledTime, session?.nickname, session?.notes, destination, sessionId]);

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
  useEffect(() => {
    if (!participantId || tripStarted || preLocationAttemptedRef.current) return;
    if (!navigator.geolocation) return;
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
  }, [participantId, tripStarted]);

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
  const panelHeightRef = useRef(80); // default collapsed height
  const [panelAtFull, setPanelAtFull] = useState(false);

  const handlePanelHeightChange = useCallback((heightPx, isFullSnap) => {
    panelHeightRef.current = heightPx;
    setPanelAtFull(isFullSnap);
  }, []);

  // ---- Map instance + smart viewport fit ----
  const mapRef = useRef(null);
  const hasDoneInitialFitRef = useRef(false);
  const prevFitStateRef = useRef(null); // { count, statuses, positions[] }

  // 'overview' fits all active participants; 'follow-me' pans to current user
  const [mapMode, setMapMode] = useState('overview');

  const handleMapLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  // Only EN_ROUTE + ALMOST_THERE participants count for auto-fit bounds
  const activeForBounds = useMemo(
    () => participants.filter(([, p]) =>
      p.status === STATUS.EN_ROUTE || p.status === STATUS.ALMOST_THERE
    ),
    [participants]
  );

  const fitMapBounds = useCallback(() => {
    if (!mapRef.current || !destination) return;

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
    // Prefer active participants; fall back to all participants for initial fit
    const group = activeForBounds.length > 0 ? activeForBounds : participants;
    let extraPoints = 0;
    group.forEach(([, p]) => { if (p.location) { bounds.extend(p.location); extraPoints++; } });

    // No participants have a location yet — center on destination at a sensible zoom.
    // Always set zoom 14 so pressing Recenter while everyone is still "not-started"
    // snaps back to a useful view rather than leaving the user at a stale zoom level.
    if (extraPoints === 0) {
      mapRef.current.setCenter({ lat: destination.lat, lng: destination.lng });
      mapRef.current.setZoom(14);
      hasDoneInitialFitRef.current = true;
      prevFitStateRef.current = { count: 0, statuses: '', positions: [] };
      return;
    }

    if (bounds.isEmpty()) return;
    if (hasDoneInitialFitRef.current && isBoundsNearby(mapRef.current, bounds)) {
      mapRef.current.panToBounds(bounds, padding);
    } else {
      mapRef.current.fitBounds(bounds, padding);
    }
  }, [destination, activeForBounds, participants]);

  // Smart fit: refit when count / status / positions change significantly
  useEffect(() => {
    if (!mapRef.current || !destination || mapMode !== 'overview') return;

    const count    = activeForBounds.length;
    const statuses = activeForBounds.map(([, p]) => p.status).join(',');
    const positions = activeForBounds.map(([, p]) => p.location).filter(Boolean);
    const prev = prevFitStateRef.current;

    const countChanged  = !prev || prev.count !== count;
    const statusChanged = !prev || prev.statuses !== statuses;
    const movedFar = prev?.positions
      ? prev.positions.some((prevLoc, i) => {
          const cur = positions[i];
          return cur ? haversineDistance(prevLoc, cur) > 200 : false;
        })
      : false;

    if (!hasDoneInitialFitRef.current || countChanged || statusChanged || movedFar) {
      fitMapBounds();
      hasDoneInitialFitRef.current = true;
      prevFitStateRef.current = { count, statuses, positions };
    }
  }, [destination, activeForBounds, mapMode, fitMapBounds]);

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
    async (name) => {
      setJoining(true);
      const pid = generateParticipantId();
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
        await joinSession(pid, name, colorIndex);
        sessionStorage.setItem(`participant_${sessionId}`, pid);
        sessionStorage.setItem(`name_${sessionId}`, name);
        setParticipantId(pid);
        logEvent('joined', name);
      } finally {
        setJoining(false);
      }
    },
    [joinSession, sessionId, participants, logEvent]
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
        // Reset debounce state so overview refits immediately on switch back
        prevFitStateRef.current = null;
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
        const result = await getETAWithRoute(location, destination, travelModeRef.current);
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
        const result = await getETAWithRoute(location, destination, travelMode);
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
        const result = await getETAWithRoute(location, destination, newMode);
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
  // isEnded (host-ended) is handled below as a SessionRecap overlay so every
  // participant sees the podium/stats before being redirected home.

  // ────────────────────────────────────────────────────────────────
  // Main session render
  // ────────────────────────────────────────────────────────────────
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

            {/* Right: icon buttons — flex-shrink: 0 so they never get pushed off-screen */}
            <div className="session-header-btns">

              {/* Note re-show button — mobile only, when group note auto-collapsed */}
              {notesAutoCollapsed && !notesDismissed && session?.notes && (
                <button
                  className="notes-info-btn"
                  onClick={() => setNotesAutoCollapsed(false)}
                  aria-label="Show group note"
                >
                  <MatIcon name="description" size={20} />
                </button>
              )}

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
                            setNotesDismissed(false);
                            setNotesAutoCollapsed(false);
                            setNotesEditing(true);
                            setNotesEditText(session?.notes ?? '');
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

            {participants.map(([id, p], index) => {
              // Spectators have no location or route — skip rendering entirely
              if (p.status === STATUS.SPECTATING) return null;
              return <RoutePolyline key={`route-${id}`} participant={p} index={index} />;
            })}

            {participants.map(([id, p], index) => {
              // Spectators have no location — never render a map pin for them
              if (p.status === STATUS.SPECTATING) return null;
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

          {/* Floating re-open button — shown after notes banner is dismissed */}
          {session?.notes && notesDismissed && (
            <button
              className="notes-reopen-btn"
              onClick={() => setNotesDismissed(false)}
              aria-label="Show group note"
            >
              <MatIcon name="description" size={20} />
            </button>
          )}

          {/* Re-center button — bottom-right, above collapsed ETA handle */}
          <RecenterButton
            mode={mapMode}
            onModeToggle={handleRecenterToggle}
          />

          {/* Status banners — stacked at top of map area */}
          <div className="session-banners">
            {/* Group note — auto-collapses on mobile after 5 s; also shows when host opens edit mode */}
            {!notesDismissed && (session?.notes || (isHost && notesEditing)) && (
              <div
                className={`notes-banner${notesAutoCollapsed ? ' notes-banner-auto-collapsed' : ''}`}
                role="note"
              >
                {!notesEditing ? (
                  <>
                    <span className="notes-banner-icon" aria-hidden="true"><MatIcon name="description" size={20} /></span>
                    <span className="notes-banner-text">{session.notes}</span>
                    <div className="notes-banner-actions">
                      {isHost && (
                        <button
                          className="notes-banner-btn notes-banner-btn-edit"
                          onClick={() => { setNotesEditing(true); setNotesEditText(session.notes); }}
                          aria-label="Edit group note"
                        >
                          <PencilIcon />
                        </button>
                      )}
                      <button
                        className="notes-banner-btn"
                        onClick={() => setNotesDismissed(true)}
                        aria-label="Dismiss note"
                      >
                        <MatIcon name="close" size={18} />
                      </button>
                    </div>
                  </>
                ) : (
                  /* Host edit mode */
                  <>
                    <span className="notes-banner-icon" aria-hidden="true"><MatIcon name="description" size={20} /></span>
                    <div className="notes-edit-wrap">
                      <textarea
                        className="notes-edit-textarea"
                        value={notesEditText}
                        onChange={(e) => setNotesEditText(e.target.value.slice(0, 200))}
                        maxLength={200}
                        rows={2}
                        autoFocus
                        aria-label="Edit group note"
                      />
                      <div className="notes-edit-footer">
                        <span className={`notes-edit-counter${notesEditText.length > 180 ? ' notes-edit-counter-warn' : ''}`}>
                          {notesEditText.length} / 200
                        </span>
                        <div className="notes-edit-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setNotesEditing(false)}
                            disabled={notesSaving}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={notesSaving}
                            onClick={async () => {
                              setNotesSaving(true);
                              try {
                                await updateNotes(notesEditText);
                              } finally {
                                setNotesSaving(false);
                                setNotesEditing(false);
                              }
                            }}
                          >
                            {notesSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Priority order (top to bottom): offline/connection > countdown > group note > nav tip */}

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
              <div className="celebration-banner" role="status" aria-live="polite">
                <MatIcon name="celebration" size={20} />
                <span>Everyone's here!</span>
              </div>
            )}
          </div>

          {/* "I'm Leaving Now" bar — hidden while countdown is active; revealed
              once countdown expires (isTimeUp) or user clicks "Leave Early". */}
          {showPreTripBar && (
            <div className="start-trip-bar">
              <p className="start-trip-hint">How are you getting there?</p>

              <div className="travel-mode-selector" role="group" aria-label="Travel mode">
                {TRAVEL_MODE_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    className={`mode-btn${travelMode === m.value ? ' mode-btn-selected' : ''}`}
                    onClick={() => { setTravelMode(m.value); setModeError(null); }}
                    aria-label={m.label}
                    aria-pressed={travelMode === m.value}
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
            </div>
          )}
        </div>

        {/* ── ETA panel — bottom sheet on mobile, sidebar on desktop ── */}
        <ETAPanel
          sessionId={sessionId}
          participants={participants}
          currentParticipantId={participantId}
          destination={destination}
          isSidebar={isSidebar}
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
          onDone={() => navigate('/')}
        />
      )}
    </div>
  );
}
