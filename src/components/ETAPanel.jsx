/**
 * ETAPanel — DoorDash-inspired 2-state bottom sheet (mobile) / fixed sidebar (desktop).
 *
 * 2-state snap: Peek (~160px, status + timeline) / Full (~85vh, all content).
 * Single scrollable view — no tabs. Participant sections followed by
 * collapsible Event Details and Recent Activity.
 *
 * Popovers (mode selector, bump options, overflow menus) are rendered via
 * React portals so they escape the panel's overflow clipping.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNow } from '../hooks/useNow';
import { createPortal } from 'react-dom';
import {
  STATUS, MAX_ETA_BUMPS, BUMP_OPTIONS_MINUTES, STATUS_EMOJIS, STALE_THRESHOLD,
} from '../config/constants';
import { getParticipantColor } from '../utils/participantColor';
import { haversineDistance } from '../utils/geo';
import { haptic } from '../utils/haptic';
import { copyToClipboard } from '../utils/clipboard';
import { timeAgo } from '../utils/formatters';
import MatIcon from './MatIcon';
import ActivityFeed from './ActivityFeed';
import EventDetails from './EventDetails';
import { AvatarIcon } from './Avatars';

const NUDGE_COOLDOWN_MS = 60_000;

// Snap geometry constants — 2-state: peek (status + timeline) and full
const PANEL_TOTAL_VH = 0.85; // panel height = 85% of viewport
const PEEK_PX        = 160;  // peek: status header + progress timeline

function getPanelTotalPx()   { return Math.round(window.innerHeight * PANEL_TOTAL_VH); }
function getSnapVisiblePx(snap) {
  if (snap === 'peek') return PEEK_PX;
  return getPanelTotalPx(); // full
}

// RSVP badge — only rendered for maybe/can't-go (going is the default, no badge)
function RsvpBadge({ rsvpStatus }) {
  if (!rsvpStatus || rsvpStatus === 'going') return null;
  const label = rsvpStatus === 'maybe' ? 'Maybe' : "Can't Go";
  const cls = rsvpStatus === 'maybe' ? 'rsvp-badge-maybe' : 'rsvp-badge-cant-go';
  return <span className={`rsvp-badge ${cls}`}>{label}</span>;
}

const SWITCH_MODE_OPTIONS = [
  { value: 'DRIVING',   iconName: 'directions_car',    label: 'Drive'   },
  { value: 'BICYCLING', iconName: 'directions_bike',   label: 'Bike'    },
  { value: 'TRANSIT',   iconName: 'directions_transit', label: 'Transit' },
  { value: 'WALKING',   iconName: 'directions_walk',   label: 'Walk'    },
];

// ─── Portal popover ──────────────────────────────────────────────────────────
function Popover({ anchorRect, onClose, children }) {
  if (!anchorRect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W  = 188;
  let top  = anchorRect.bottom + 6;
  let left = anchorRect.right - W;
  left = Math.max(8, Math.min(left, vw - W - 8));
  if (top + 200 > vh) top = Math.max(8, anchorRect.top - 206);
  return createPortal(
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover-card" style={{ top, left }}>
        {children}
      </div>
    </>,
    document.body,
  );
}

// ─── SVG icons ───────────────────────────────────────────────────────────────
function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6"  y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

// ─── Status emoji helper ─────────────────────────────────────────────────────
// Backward-compat: legacy data stored Material icon names (e.g. "coffee"),
// newer data stores actual emoji chars (e.g. "☕"). Map old → new for display.
const ICON_TO_EMOJI = { coffee: '☕', local_gas_station: '⛽', local_parking: '🅿️', traffic: '🚦', sprint: '🏃', shopping_cart: '🛒' };
function resolveEmoji(statusEmoji) {
  if (!statusEmoji) return null;
  return ICON_TO_EMOJI[statusEmoji] || statusEmoji;
}
function StatusIcon({ statusEmoji, size = 16 }) {
  const emoji = resolveEmoji(statusEmoji);
  if (!emoji) return null;
  return <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>;
}

// ─── Progress timeline (peek header) ──────────────────────────────────────────
function ProgressTimeline({ enRoute = [], arrivedList = [], colorMap = {}, now }) {
  const all = [...enRoute, ...arrivedList];
  if (all.length === 0) return null;

  // Compute max ETA for positioning
  let maxEtaMs = 0;
  for (const [, p] of enRoute) {
    const ms = etaMs(p, now);
    if (ms != null) {
      const remaining = Math.max(0, ms - now);
      if (remaining > maxEtaMs) maxEtaMs = remaining;
    }
  }
  if (maxEtaMs === 0) maxEtaMs = 1; // avoid division by zero

  return (
    <div className="eta-progress-timeline">
      <div className="eta-progress-line" />
      {enRoute.map(([id, p]) => {
        const ms = etaMs(p, now);
        const remaining = ms != null ? Math.max(0, ms - now) : maxEtaMs;
        const pct = Math.max(5, Math.min(90, (1 - remaining / maxEtaMs) * 90));
        return (
          <div key={id} className="eta-progress-dot" style={{ left: `${pct}%` }}>
            <div className="eta-progress-dot-circle" style={{ background: colorMap[id] || '#94a3b8' }} />
            <span className="eta-progress-label">{(p.name || '?').slice(0, 6)}</span>
          </div>
        );
      })}
      {arrivedList.map(([id, p]) => (
        <div key={id} className="eta-progress-dot" style={{ left: '95%' }}>
          <div className="eta-progress-dot-circle eta-progress-dot-arrived" style={{ background: colorMap[id] || '#94a3b8' }}>
            <MatIcon name="check" size={8} />
          </div>
          <span className="eta-progress-label">{(p.name || '?').slice(0, 6)}</span>
        </div>
      ))}
      <div className="eta-progress-dest">
        <MatIcon name="location_on" size={16} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ETAPanel({
  sessionId,
  session = null,
  participants,
  currentParticipantId,
  hostId = null,
  isHost = false,
  isViewerHostOrCoHost = false,
  onPromoteCoHost = null,
  onDemoteCoHost = null,
  onToggleVisibility = () => {},
  destination,
  isSidebar = false,
  onPause,
  onResume,
  onSwitchMode,
  modeSwitchCooldownUntil = 0,
  onBumpETA,
  onBumpRecalculate,
  onToggleKeepVisible = () => {},
  onStatusEmoji = () => {},
  onManualArrival = null,
  showImHereButton = false,
  gpsLost = false,
  onHeightChange = null,  // (heightPx: number, isFullSnap: boolean) => void
  onExitSpectating = null,
}) {
  // 1-second tick drives countdowns and close-race detection
  const now = useNow(1000);


  // ── Snap state (mobile only) — 2-state: peek / full ─────────────────────
  const [snapPoint, setSnapPoint] = useState('peek');
  const snapPointRef = useRef('peek');
  function updateSnapPoint(snap) {
    snapPointRef.current = snap;
    setSnapPoint(snap);
  }

  // ── Collapsible sections in full view ─────────────────────────────────────
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // ── Panel refs ────────────────────────────────────────────────────────────
  const panelRef = useRef(null);
  const isDraggingRef = useRef(false);
  // Keep onHeightChange stable in closures via ref
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => { onHeightChangeRef.current = onHeightChange; }, [onHeightChange]);

  // ── Init / isSidebar changes ──────────────────────────────────────────────
  useEffect(() => {
    if (isSidebar) {
      // Desktop sidebar: clear any mobile transform
      if (panelRef.current) {
        panelRef.current.style.transform = '';
        panelRef.current.style.transition = '';
      }
      const h = panelRef.current?.offsetHeight ?? window.innerHeight;
      document.documentElement.style.setProperty('--panel-height', `${h}px`);
      onHeightChangeRef.current?.(h, false);
      return;
    }
    // Mobile: set initial peek position (no animation)
    const visible = PEEK_PX;
    const ty = getPanelTotalPx() - visible;
    if (panelRef.current) {
      panelRef.current.style.transition = 'none';
      panelRef.current.style.transform = `translateY(${ty}px)`;
    }
    document.documentElement.style.setProperty('--panel-height', `${visible}px`);
    updateSnapPoint('peek');
    onHeightChangeRef.current?.(visible, false);
  }, [isSidebar]);

  // ── Touch drag — DOM event listeners (non-passive touchmove for preventDefault) ──
  useEffect(() => {
    if (isSidebar) return;
    const panel = panelRef.current;
    if (!panel) return;

    let dragStartY    = null;
    let dragStartVis  = null;

    const onStart = (e) => {
      // Block drag on interactive elements
      if (e.target.closest('button, input, textarea, select, a')) return;

      const inPinned  = !!e.target.closest('.eta-pinned-area');
      const inContent = !!e.target.closest('.eta-scroll-body');
      // Content-area drag only when not at Full (scroll lock means no competing scroll)
      if (!inPinned && !(inContent && snapPointRef.current !== 'full')) return;

      const raw = panel.style.transform;
      const match = raw.match(/translateY\((\d+(?:\.\d+)?)px\)/);
      const currentTY = match ? parseFloat(match[1]) : (getPanelTotalPx() - PEEK_PX);

      dragStartY   = e.touches[0].clientY;
      dragStartVis = getPanelTotalPx() - currentTY;
      isDraggingRef.current = true;
      panel.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const dy         = e.touches[0].clientY - dragStartY;
      const newVisible = Math.max(PEEK_PX, Math.min(getPanelTotalPx(), dragStartVis - dy));
      panel.style.transform = `translateY(${getPanelTotalPx() - newVisible}px)`;
      // Update CSS var continuously so floating controls track in real-time
      document.documentElement.style.setProperty('--panel-height', `${newVisible}px`);
    };

    const onEnd = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const raw = panel.style.transform;
      const match = raw.match(/translateY\((\d+(?:\.\d+)?)px\)/);
      const currentTY  = match ? parseFloat(match[1]) : (getPanelTotalPx() - PEEK_PX);
      const currentVis = getPanelTotalPx() - currentTY;

      const snapOptions = [
        { name: 'peek', visible: getSnapVisiblePx('peek') },
        { name: 'full', visible: getSnapVisiblePx('full') },
      ];
      const nearest = snapOptions.reduce((best, sp) =>
        Math.abs(currentVis - sp.visible) < Math.abs(currentVis - best.visible) ? sp : best
      );

      // Snap with smooth transition
      const targetTY = getPanelTotalPx() - nearest.visible;
      panel.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
      panel.style.transform  = `translateY(${targetTY}px)`;
      document.documentElement.style.setProperty('--panel-height', `${nearest.visible}px`);
      updateSnapPoint(nearest.name);
      // Notify Session.jsx after snap animation completes
      setTimeout(() => {
        onHeightChangeRef.current?.(nearest.visible, nearest.name === 'full');
      }, 380);
    };

    panel.addEventListener('touchstart', onStart, { passive: true  });
    panel.addEventListener('touchmove',  onMove,  { passive: false });
    panel.addEventListener('touchend',   onEnd,   { passive: true  });
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove',  onMove);
      panel.removeEventListener('touchend',   onEnd);
    };
  }, [isSidebar]);

  // ── Unified popover state ─────────────────────────────────────────────────
  const [activePopover, setActivePopover] = useState(null);
  const [modeError,     setModeError]     = useState(null);
  const [modeLoading,   setModeLoading]   = useState(false);

  // Emoji picker
  const [emojiPickerId, setEmojiPickerId] = useState(null);

  // Panel-level feedback toast
  const [feedbackToast, setFeedbackToast] = useState(null);
  const feedbackTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(feedbackTimerRef.current), []);

  // Nudge cooldowns
  const [nudgeCooldowns, setNudgeCooldowns] = useState({});

  // Stable colour map
  const colorMap = useMemo(() => {
    const map = {};
    participants.forEach(([id, p], i) => { map[id] = getParticipantColor(p, i); });
    return map;
  }, [participants]);

  // Pre-trip arrival order preview
  const arrivalPreviewName = useMemo(() => {
    if (participants.length < 2 || !destination) return null;
    const allNotStarted = participants.every(([, p]) =>
      (p.status ?? STATUS.NOT_STARTED) === STATUS.NOT_STARTED
    );
    if (!allNotStarted) return null;
    if (!participants.every(([, p]) => p.location != null)) return null;
    const ranked = [...participants].sort(([, a], [, b]) =>
      haversineDistance(a.location, destination) - haversineDistance(b.location, destination)
    );
    return ranked[0][1].name ?? null;
  }, [participants, destination]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function openPopover(type, participantId, btn) {
    setModeError(null);
    setActivePopover({ type, participantId, rect: btn.getBoundingClientRect() });
  }
  function closePopover() { setActivePopover(null); }

  function showFeedback(msg, durationMs = 2_500) {
    setFeedbackToast(msg);
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedbackToast(null), durationMs);
  }

  async function handleModeSelect(newMode, currentMode) {
    if (newMode === currentMode) { closePopover(); return; }
    setModeLoading(true);
    setModeError(null);
    try {
      await onSwitchMode(newMode);
      haptic(50);
      closePopover();
    } catch (err) {
      setModeError(
        err?.code === 'ZERO_RESULTS'
          ? 'No route for this mode — try another.'
          : 'Mode switch failed. Try again.',
      );
    } finally {
      setModeLoading(false);
    }
  }

  async function handleBump(mins) {
    await onBumpETA(mins);
    haptic(50);
    closePopover();
    showFeedback(`+${mins} min added to ETA`);
  }

  function handleNudge(participantId) {
    window.open('sms:?body=', '_self');
    setNudgeCooldowns(prev => ({ ...prev, [participantId]: Date.now() + NUDGE_COOLDOWN_MS }));
  }

  async function handleShareETA(p) {
    const dest = destination?.name || destination?.address || 'the destination';
    const url  = window.location.href;
    let msg;
    if (p.status === STATUS.ARRIVED) {
      msg = `I've arrived at ${dest}! Track everyone: ${url}`;
    } else if (p.status === STATUS.PAUSED) {
      msg = `I'm heading to ${dest} — track me live: ${url}`;
    } else {
      const ms          = etaMs(p, Date.now());
      const mins        = ms != null ? Math.round((ms - Date.now()) / 60_000) : null;
      const arrivalStr  = ms != null ? formatArrivalTime(ms) : null;
      const distPart    = mins != null && mins > 0 ? `${mins} min` : 'almost';
      const arrivalPart = arrivalStr ? `, arriving at ${arrivalStr}` : '';
      msg = `I'm ${distPart} away from ${dest}${arrivalPart} — track me live: ${url}`;
    }
    if (navigator.share) {
      try { await navigator.share({ text: msg }); } catch { /* cancelled */ }
    } else {
      try {
        await copyToClipboard(msg);
        haptic(50);
        showFeedback('ETA copied!');
      } catch { /* clipboard unavailable */ }
    }
  }

  // ── Programmatic snap (used by tap-to-toggle on handle / summary row) ────
  function snapToPoint(snap) {
    const panel = panelRef.current;
    if (!panel || isSidebar) return;
    const visible  = getSnapVisiblePx(snap);
    const targetTY = getPanelTotalPx() - visible;
    panel.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    panel.style.transform  = `translateY(${targetTY}px)`;
    document.documentElement.style.setProperty('--panel-height', `${visible}px`);
    updateSnapPoint(snap);
    setTimeout(() => {
      onHeightChangeRef.current?.(visible, snap === 'full');
    }, 380);
  }

  function handleHeaderTap() {
    snapToPoint(snapPoint === 'peek' ? 'full' : 'peek');
  }

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!participants.length) return null;

  // ── Bucket participants ────────────────────────────────────────────────────
  const enRoute        = [];
  const pausedList     = [];
  const arrivedList    = [];
  const waiting        = [];
  const spectatingList = [];
  const notGoingList   = []; // maybe + can't-go (not sharing location)

  for (const entry of participants) {
    const [, p] = entry;
    const rsvp = p.rsvpStatus ?? 'going';
    const s = p.status ?? STATUS.NOT_STARTED;
    // Maybe / Can't-go with no trip started → show in Not Going section
    if ((rsvp === 'maybe' || rsvp === 'cant-go') && s === STATUS.NOT_STARTED) {
      notGoingList.push(entry);
    } else if (s === STATUS.SPECTATING)  spectatingList.push(entry);
    else if (s === STATUS.NOT_STARTED)   waiting.push(entry);
    else if (s === STATUS.ARRIVED)       arrivedList.push(entry);
    else if (s === STATUS.PAUSED)        pausedList.push(entry);
    else                                 enRoute.push(entry);
  }

  // ── RSVP summary ─────────────────────────────────────────────────────────
  const rsvpCounts = useMemo(() => {
    let going = 0, maybe = 0, cantGo = 0;
    for (const [, p] of participants) {
      const r = p.rsvpStatus ?? 'going';
      if (r === 'going')   { going += 1 + (p.plusOnes ?? 0); }
      else if (r === 'maybe')   maybe++;
      else if (r === 'cant-go') cantGo++;
    }
    return { going, maybe, cantGo };
  }, [participants]);

  enRoute.sort(([, a], [, b]) => {
    const aMs = etaMs(a, now), bMs = etaMs(b, now);
    if (aMs == null && bMs == null) return 0;
    if (aMs == null) return 1; if (bMs == null) return -1;
    return aMs - bMs;
  });
  arrivedList.sort(([, a], [, b]) => (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0));

  const closeRaceSet = new Set();
  for (let i = 0; i < enRoute.length - 1; i++) {
    const aMs = etaMs(enRoute[i][1], now);
    const bMs = etaMs(enRoute[i + 1][1], now);
    if (aMs != null && bMs != null && bMs - aMs <= 60_000) {
      closeRaceSet.add(i); closeRaceSet.add(i + 1);
    }
  }

  const hasEnRoute  = enRoute.length > 0;
  const hasPaused   = pausedList.length > 0;
  const hasArrived  = arrivedList.length > 0;
  const hasWaiting  = waiting.length > 0;

  // Collapsed summary — "3 of 8 · Next arrives: 12 min" or "3 people · Next arrives: 12 min"
  const nextArrivalMins = (() => {
    let minMs = Infinity;
    for (const [, p] of enRoute) {
      const ms = etaMs(p, now);
      if (ms != null && ms < minMs) minMs = ms;
    }
    if (minMs === Infinity) return null;
    return Math.ceil(Math.max(0, minMs - now) / 60_000);
  })();
  const _expectedCount = session?.expectedCount ?? null;
  const _count = participants.length;
  const _countPart = _expectedCount
    ? `${_count} of ${_expectedCount}`
    : `${_count} ${_count === 1 ? 'person' : 'people'}`;
  const _nextPart = nextArrivalMins != null
    ? (nextArrivalMins <= 0 ? 'Arriving now' : `Next arrives: ${nextArrivalMins} min`)
    : null;
  const isCooldownActive      = modeSwitchCooldownUntil > now;
  const cooldownSecsRemaining = isCooldownActive ? Math.ceil((modeSwitchCooldownUntil - now) / 1000) : 0;

  // Summary text for peek header
  const summaryParts = [];
  if (enRoute.length)        summaryParts.push(`${enRoute.length} en route`);
  if (pausedList.length)     summaryParts.push(`${pausedList.length} paused`);
  if (arrivedList.length)    summaryParts.push(`${arrivedList.length} arrived`);
  if (spectatingList.length) summaryParts.push(`${spectatingList.length} watching`);
  if (waiting.length && (enRoute.length || pausedList.length || arrivedList.length)) {
    summaryParts.push(`${waiting.length} waiting`);
  } else if (waiting.length) {
    summaryParts.push(`${waiting.length} waiting to leave`);
  }
  const summaryText = summaryParts.join(' · ') ||
    `${participants.length} participant${participants.length !== 1 ? 's' : ''}`;

  const popoverP = activePopover
    ? participants.find(([id]) => id === activePopover.participantId)?.[1]
    : null;

  // Scroll lock: body scrolls only when fully expanded or in sidebar
  const contentOverflow = (snapPoint === 'full' || isSidebar) ? 'auto' : 'hidden';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={panelRef} className="eta-panel">

      {/* ── Peek header: status + progress timeline ── */}
      <div
        className="eta-pinned-area"
        onClick={!isSidebar ? handleHeaderTap : undefined}
        style={!isSidebar ? { cursor: 'pointer' } : undefined}
      >
        {!isSidebar && (
          <div className="eta-handle-pill" aria-hidden="true" />
        )}

        <div className="eta-peek-header">
          <div className="eta-peek-status-row">
            <span className="eta-peek-status">{summaryText}</span>
            <span className="eta-peek-count">
              {_expectedCount ? `${_count}/${_expectedCount}` : `${_count} people`}
            </span>
          </div>
          {_nextPart && (
            <div className="eta-peek-next">{_nextPart}</div>
          )}
        </div>

        {/* Progress timeline — dots for each participant */}
        <ProgressTimeline
          enRoute={enRoute}
          arrivedList={arrivedList}
          colorMap={colorMap}
          now={now}
        />
      </div>

      {/* Panel-level feedback toast — above tab content, always visible */}
      {feedbackToast && (
        <div className="eta-panel-toast" role="status" aria-live="polite">{feedbackToast}</div>
      )}

      {/* ── Single scrollable body ── */}
      <div className="eta-scroll-body" style={{ overflowY: contentOverflow }}>

          {/* Hidden mode chip — shown when the current user is in hidden mode */}
          {participants.find(([id]) => id === currentParticipantId)?.[1]?.visibility === 'hidden' && (
            <div className="eta-hidden-mode-chip" role="status">
              <MatIcon name="visibility_off" size={14} />
              <span>You're in hidden mode</span>
              <button
                type="button"
                className="eta-hidden-mode-go-visible"
                onClick={() => onToggleVisibility('visible')}
              >
                Go visible
              </button>
            </div>
          )}

          {/* Arrival order preview */}
          {arrivalPreviewName && (
            <div className="eta-arrival-preview" role="note">
              Based on distance, <strong>{arrivalPreviewName}</strong> will likely arrive first <MatIcon name="sports_score" size={16} />
            </div>
          )}

          {/* ── En-route / almost-there ── */}
          {hasEnRoute && (hasArrived || hasWaiting || hasPaused) && (
            <div className="eta-section-header">En route</div>
          )}
          {enRoute.map(([id, p], index) => {
            const isMe        = id === currentParticipantId;
            const isAnon      = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const almostThere = p.status === STATUS.ALMOST_THERE;
            const isCloseRace = closeRaceSet.has(index);
            const activeMode  = p.travelMode ?? 'DRIVING';
            const bumpCount   = p.bumpCount ?? 0;
            const manualDelay = p.manualDelayMs ?? 0;
            const atMaxBumps  = bumpCount >= MAX_ETA_BUMPS;
            const pColor      = isAnon ? '#94a3b8' : colorMap[id];
            const isStale     = !isAnon && !!(p.lastUpdated && (now - p.lastUpdated) > STALE_THRESHOLD);
            const etaMsVal    = isAnon ? null : etaMs(p, now);
            const hasWarnings = !isAnon && ((isMe && gpsLost) || isStale);

            return (
              <div
                key={id}
                className={[
                  'eta-card',
                  isMe         ? 'eta-card-me'           : '',
                  almostThere  ? 'eta-card-almost-there' : '',
                ].filter(Boolean).join(' ')}
              >
                {/* Row 1 */}
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                      {!isAnon && <StatusIcon statusEmoji={p.statusEmoji} />}
                    </span>
                    {!isAnon && <RsvpBadge rsvpStatus={p.rsvpStatus} />}
                    {!isAnon && p.plusOnes > 0 && <span className="eta-plus-ones">+{p.plusOnes}</span>}
                    {!isAnon && p.visibility === 'hidden' && isViewerHostOrCoHost && (
                      <span className="eta-hidden-badge" title="Hidden participant"><MatIcon name="visibility_off" size={12} /></span>
                    )}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                    {!isAnon && index < 3 && (
                      <span className="eta-ordinal-pill">{ordinal(index + 1)}</span>
                    )}
                    {!isAnon && isCloseRace && (
                      <span className="eta-close-race" aria-label="Close race"><MatIcon name="bolt" size={14} /></span>
                    )}
                  </div>
                  <div className="eta-card-r1-right">
                    {!isAnon && <span className="eta-r1-mode"><MatIcon name={getModeIconName(activeMode)} size={20} /></span>}
                    <span className={`eta-r1-countdown${isAnon ? ' eta-r1-muted' : ''}`}>
                      {isAnon ? '—' : smartCountdown(p, now)}
                    </span>
                  </div>
                </div>

                {/* Row 2 */}
                {!isAnon && (
                  <div className="eta-card-r2">
                    <span className="eta-status-label">
                      {almostThere ? (
                        <><span className="eta-pulse-dot" aria-hidden="true" />Almost there!</>
                      ) : p.travelMode === 'TRANSIT' && p.transitInfo ? (
                        <><MatIcon name={getTransitIconName(p.transitInfo.vehicleType)} size={16} />{' '}{p.transitInfo.line ?? 'Transit'}</>
                      ) : p.location ? 'En route' : 'Getting location…'}
                    </span>
                    <div className="eta-card-r2-right">
                      {etaMsVal != null && (
                        <>
                          <span className="eta-arrival-time-label">
                        {activeMode === 'TRANSIT' ? 'Scheduled ' : 'Arrives '}{formatArrivalTime(etaMsVal)}
                      </span>
                          {p.routeDistance && (
                            <>
                              <span className="eta-dot-sep" aria-hidden="true">·</span>
                              <span className="eta-dist-label">{p.routeDistance}</span>
                            </>
                          )}
                        </>
                      )}
                      {manualDelay > 0 && (
                        <span className="eta-delay-badge" title={`+${Math.round(manualDelay / 60_000)} min delay added`}>
                          +{Math.round(manualDelay / 60_000)}m
                        </span>
                      )}
                      {!isMe && (
                        <button
                          className="eta-overflow-btn"
                          onClick={(e) => { e.stopPropagation(); openPopover('overflow-other', id, e.currentTarget); }}
                          title="More options"
                          aria-label={`More options for ${p.name}`}
                        >···</button>
                      )}
                    </div>
                  </div>
                )}

                {/* Row 3 — warning pills */}
                {hasWarnings && (
                  <div className="eta-card-r3">
                    {isMe && gpsLost && (
                      <span className="eta-warning-pill" role="alert"><MatIcon name="warning" size={14} /> GPS signal lost</span>
                    )}
                    {isStale && !(isMe && gpsLost) && (
                      <button
                        className="eta-warning-pill eta-warning-pill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const ago = timeAgo(p.lastUpdated, now);
                          showFeedback(
                            `Last update was ${ago}. This can happen when the app is backgrounded.`,
                            4_000,
                          );
                        }}
                        aria-label={`${p.name}'s location is stale — tap for details`}
                      ><MatIcon name="schedule" size={14} /> {timeAgo(p.lastUpdated, now)}</button>
                    )}
                  </div>
                )}

                {/* Row 4 — action buttons (own card only, never for anon) */}
                {isMe && (
                  <div className="eta-card-r4">
                    <button
                      className="eta-icon-btn eta-icon-btn-pause"
                      onClick={(e) => { e.stopPropagation(); onPause(); }}
                      title="Pause sharing"
                      aria-label="Pause location sharing"
                    >
                      <PauseIcon />
                    </button>
                    <button
                      className="eta-icon-btn eta-icon-btn-mode"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isCooldownActive) {
                          showFeedback(`You can switch mode again in ${cooldownSecsRemaining}s`);
                        } else {
                          openPopover('mode', id, e.currentTarget);
                        }
                      }}
                      title={isCooldownActive ? `Switch available in ${cooldownSecsRemaining}s` : 'Switch travel mode'}
                      aria-label="Switch travel mode"
                      aria-disabled={isCooldownActive}
                      style={isCooldownActive ? { opacity: 0.45, cursor: 'default' } : undefined}
                    ><MatIcon name="commute" size={20} /></button>
                    <button
                      className="eta-icon-btn eta-icon-btn-bump"
                      onClick={(e) => { e.stopPropagation(); openPopover('bump', id, e.currentTarget); }}
                      title={atMaxBumps ? 'Max bumps used' : 'Add time to ETA'}
                      aria-label="Add time to ETA"
                      disabled={atMaxBumps}
                    ><MatIcon name="add_circle" size={20} /></button>
                    <button
                      className={`eta-icon-btn eta-icon-btn-emoji${emojiPickerId === id ? ' eta-icon-btn-active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setEmojiPickerId(v => v === id ? null : id); }}
                      title="Set status emoji"
                      aria-label="Set status emoji"
                      aria-expanded={emojiPickerId === id}
                    ><MatIcon name="mood" size={20} /></button>
                    <button
                      className="eta-icon-btn eta-icon-btn-overflow"
                      onClick={(e) => { e.stopPropagation(); openPopover('overflow-me', id, e.currentTarget); }}
                      title="More options"
                      aria-label="More options"
                    >···</button>
                  </div>
                )}

                {/* Mode switch cooldown hint */}
                <div className="eta-cooldown-hint-wrap">
                  {isCooldownActive && isMe && (
                    <span className="eta-cooldown-hint" role="status" aria-live="polite">
                      Switch available in {cooldownSecsRemaining}s
                    </span>
                  )}
                </div>

                {/* Emoji strip */}
                {emojiPickerId === id && (
                  <div className="eta-emoji-strip" onClick={(e) => e.stopPropagation()}>
                    {STATUS_EMOJIS.map(({ emoji, label }) => (
                      <button
                        key={emoji}
                        className={`eta-emoji-btn${p.statusEmoji === emoji ? ' eta-emoji-btn-active' : ''}`}
                        onClick={() => {
                          onStatusEmoji(p.statusEmoji === emoji ? null : emoji);
                          setEmojiPickerId(null);
                          haptic(30);
                        }}
                        aria-label={label}
                        aria-pressed={p.statusEmoji === emoji}
                      >{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Paused ── */}
          {hasPaused && (hasEnRoute || hasArrived || hasWaiting) && (
            <div className="eta-section-header">Paused</div>
          )}
          {pausedList.map(([id, p]) => {
            const isMe   = id === currentParticipantId;
            const isAnon = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const pColor = isAnon ? '#94a3b8' : colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-paused', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                      {!isAnon && <StatusIcon statusEmoji={p.statusEmoji} />}
                    </span>
                    {!isAnon && p.plusOnes > 0 && <span className="eta-plus-ones">+{p.plusOnes}</span>}
                    {!isAnon && p.visibility === 'hidden' && isViewerHostOrCoHost && (
                      <span className="eta-hidden-badge" title="Hidden participant"><MatIcon name="visibility_off" size={12} /></span>
                    )}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                    <span className="eta-paused-badge" aria-label="paused"><MatIcon name="pause_circle" size={16} /></span>
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-countdown eta-r1-muted">—</span>
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label eta-status-paused">Location paused</span>
                </div>
                {isMe && (
                  <div className="eta-card-r4">
                    <button
                      className="eta-icon-btn eta-icon-btn-resume"
                      onClick={(e) => { e.stopPropagation(); onResume(); }}
                      title="Resume sharing"
                      aria-label="Resume location sharing"
                    >
                      <PlayIcon />
                    </button>
                    <button
                      className={`eta-icon-btn eta-icon-btn-emoji${emojiPickerId === id ? ' eta-icon-btn-active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setEmojiPickerId(v => v === id ? null : id); }}
                      title="Set status emoji"
                      aria-label="Set status emoji"
                      aria-expanded={emojiPickerId === id}
                    ><MatIcon name="mood" size={20} /></button>
                  </div>
                )}
                {emojiPickerId === id && (
                  <div className="eta-emoji-strip" onClick={(e) => e.stopPropagation()}>
                    {STATUS_EMOJIS.map(({ emoji, label }) => (
                      <button
                        key={emoji}
                        className={`eta-emoji-btn${p.statusEmoji === emoji ? ' eta-emoji-btn-active' : ''}`}
                        onClick={() => { onStatusEmoji(p.statusEmoji === emoji ? null : emoji); setEmojiPickerId(null); haptic(30); }}
                        aria-label={label}
                        aria-pressed={p.statusEmoji === emoji}
                      >{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Arrived ── */}
          {hasArrived && (hasEnRoute || hasPaused || hasWaiting) && (
            <div className="eta-section-header">Arrived</div>
          )}
          {arrivedList.map(([id, p]) => {
            const isMe   = id === currentParticipantId;
            const isAnon = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const pColor = isAnon ? '#94a3b8' : colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-arrived', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                      {!isAnon && <StatusIcon statusEmoji={p.statusEmoji} />}
                    </span>
                    {!isAnon && p.plusOnes > 0 && <span className="eta-plus-ones">+{p.plusOnes}</span>}
                    {!isAnon && p.visibility === 'hidden' && isViewerHostOrCoHost && (
                      <span className="eta-hidden-badge" title="Hidden participant"><MatIcon name="visibility_off" size={12} /></span>
                    )}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                    <span className="eta-arrived-check" aria-label="arrived"><MatIcon name="check_circle" size={16} fill /></span>
                  </div>
                  <div className="eta-card-r1-right">
                    {!isAnon && p.lastUpdated && (
                      <span className="eta-r1-arrived-time">{formatArrivalTime(p.lastUpdated)}</span>
                    )}
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label">Arrived!</span>
                  {!isAnon && (
                    <div className="eta-card-r2-right">
                      <button
                        className="eta-overflow-btn"
                        onClick={(e) => { e.stopPropagation(); openPopover('overflow-arrived', id, e.currentTarget); }}
                        title="More options"
                        aria-label={`More options for ${p.name}`}
                      >···</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Waiting to leave ── */}
          {hasWaiting && (hasEnRoute || hasPaused || hasArrived) && (
            <div className="eta-section-header">Waiting to leave</div>
          )}
          {waiting.map(([id, p]) => {
            const isMe        = id === currentParticipantId;
            const isAnon      = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const pColor      = isAnon ? '#94a3b8' : colorMap[id];
            const nudgeEnd    = nudgeCooldowns[id] ?? 0;
            const nudgeActive = nudgeEnd > now;
            const nudgeSecs   = nudgeActive ? Math.ceil((nudgeEnd - now) / 1000) : 0;
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-waiting', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                    </span>
                    {!isAnon && <RsvpBadge rsvpStatus={p.rsvpStatus} />}
                    {!isAnon && p.plusOnes > 0 && <span className="eta-plus-ones">+{p.plusOnes}</span>}
                    {!isAnon && p.visibility === 'hidden' && isViewerHostOrCoHost && (
                      <span className="eta-hidden-badge" title="Hidden participant"><MatIcon name="visibility_off" size={12} /></span>
                    )}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-countdown eta-r1-muted">—</span>
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label">Waiting to start</span>
                  {!isAnon && currentParticipantId && !isMe && (
                    <div className="eta-card-r2-right">
                      <button
                        className={`eta-nudge-btn${nudgeActive ? ' eta-nudge-btn-sent' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleNudge(id); }}
                        disabled={nudgeActive}
                        aria-label={nudgeActive ? `Nudged — wait ${nudgeSecs}s` : `Nudge ${p.name}`}
                        title={nudgeActive ? `Wait ${nudgeSecs}s to nudge again` : `Send ${p.name} a reminder`}
                      >{nudgeActive ? `${nudgeSecs}s` : <MatIcon name="sms" size={20} />}</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Spectating ── */}
          {spectatingList.length > 0 && (
            <div className="eta-section-header">Spectating <MatIcon name="visibility" size={16} /></div>
          )}
          {spectatingList.map(([id, p]) => {
            const isMe   = id === currentParticipantId;
            const isAnon = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const pColor = isAnon ? '#94a3b8' : colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-spectating', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                {/* Row 1 only — ultra-compact; no ETA countdown (spectators have none) */}
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                    </span>
                    {!isAnon && p.visibility === 'hidden' && isViewerHostOrCoHost && (
                      <span className="eta-hidden-badge" title="Hidden participant"><MatIcon name="visibility_off" size={12} /></span>
                    )}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-countdown eta-r1-muted"><MatIcon name="visibility" size={16} /></span>
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label eta-status-muted">Spectating</span>
                </div>
                {/* Row 4: current user gets a "Start Trip" button to exit spectating;
                    other spectator cards have no actions (no nudge target either) */}
                {isMe && onExitSpectating && (
                  <div className="eta-card-r4">
                    <button
                      className="btn btn-primary btn-full eta-spectate-start-btn"
                      onClick={(e) => { e.stopPropagation(); onExitSpectating(); }}
                    >
                      <MatIcon name="directions_car" size={20} /> Start Trip
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Not Going (Maybe / Can't Go) ── */}
          {notGoingList.length > 0 && (
            <div className="eta-section-header">Not going</div>
          )}
          {notGoingList.map(([id, p]) => {
            const isMe   = id === currentParticipantId;
            const isAnon = p.visibility === 'hidden' && !isMe && !isViewerHostOrCoHost;
            const pColor = isAnon ? '#94a3b8' : colorMap[id];
            return (
              <div key={id} className="eta-card eta-card-waiting">
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {isAnon ? '?' : (p.avatarId != null ? <AvatarIcon avatarId={p.avatarId} size={20} /> : (p.name?.[0]?.toUpperCase() ?? '?'))}
                    </div>
                    <span className="eta-card-name">
                      {isAnon ? 'Anonymous Guest' : (p.name + (isMe ? ' (you)' : ''))}
                    </span>
                    {!isAnon && <RsvpBadge rsvpStatus={p.rsvpStatus} />}
                    {!isAnon && p.plusOnes > 0 && <span className="eta-plus-ones">+{p.plusOnes}</span>}
                    {!isAnon && id === hostId && <span className="eta-host-chip">Host</span>}
                    {!isAnon && id !== hostId && !!session?.permissions?.coHosts?.[id] && <span className="eta-cohost-chip">Co-Host</span>}
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-countdown eta-r1-muted">—</span>
                  </div>
                </div>
              </div>
            );
          })}

        {/* ── Event Details (collapsible) ── */}
        <div className="eta-section-collapse">
          <button
            className="eta-section-collapse-header"
            onClick={() => setDetailsOpen(v => !v)}
            aria-expanded={detailsOpen}
          >
            <span>Event Details</span>
            <MatIcon name={detailsOpen ? 'expand_less' : 'expand_more'} size={20} />
          </button>
          {detailsOpen && (
            <div className="eta-section-collapse-body">
              <EventDetails
                session={session}
                participants={participants}
                isHost={isHost}
              />
            </div>
          )}
        </div>

        {/* ── Recent Activity (collapsible) ── */}
        <div className="eta-section-collapse">
          <button
            className="eta-section-collapse-header"
            onClick={() => setActivityOpen(v => !v)}
            aria-expanded={activityOpen}
          >
            <span>Recent Activity</span>
            <MatIcon name={activityOpen ? 'expand_less' : 'expand_more'} size={20} />
          </button>
          {activityOpen && (
            <div className="eta-section-collapse-body">
              <ActivityFeed
                sessionId={sessionId}
                variant="panel"
                maxDisplay={50}
                emptyText="No activity yet"
              />
            </div>
          )}
        </div>

      </div>

      {/* ── Portal-based popovers ── */}
      {activePopover && popoverP && (
        <Popover anchorRect={activePopover.rect} onClose={closePopover}>

          {activePopover.type === 'mode' && (
            <div className="popover-mode-grid">
              {SWITCH_MODE_OPTIONS.map(m => (
                <button
                  key={m.value}
                  className={`popover-mode-btn${(popoverP.travelMode ?? 'DRIVING') === m.value ? ' popover-mode-btn-active' : ''}`}
                  onClick={() => handleModeSelect(m.value, popoverP.travelMode ?? 'DRIVING')}
                  disabled={modeLoading || isCooldownActive}
                  aria-pressed={(popoverP.travelMode ?? 'DRIVING') === m.value}
                  aria-label={m.label}
                >
                  <MatIcon name={m.iconName} size={20} />
                  <span className="popover-mode-label">{m.label}</span>
                </button>
              ))}
              {isCooldownActive && (
                <p className="popover-note" role="status">Wait {cooldownSecsRemaining}s to switch</p>
              )}
              {modeError && <p className="popover-error" role="alert">{modeError}</p>}
            </div>
          )}

          {activePopover.type === 'bump' && (
            <div className="popover-items">
              {BUMP_OPTIONS_MINUTES.map(mins => (
                <button key={mins} className="popover-item" onClick={() => handleBump(mins)}>
                  +{mins} min
                </button>
              ))}
            </div>
          )}

          {activePopover.type === 'overflow-me' && (
            <div className="popover-items">
              <button className="popover-item" onClick={() => { onBumpRecalculate(); closePopover(); }}>
                <MatIcon name="refresh" size={16} /> Recalculate ETA
              </button>
              <button className="popover-item" onClick={() => { handleShareETA(popoverP); closePopover(); }}>
                Share My ETA
              </button>
              {showImHereButton && onManualArrival && (
                <button className="popover-item" onClick={() => { onManualArrival(); closePopover(); }}>
                  I'm Here <MatIcon name="location_on" size={16} />
                </button>
              )}
            </div>
          )}

          {activePopover.type === 'overflow-other' && (() => {
            const nEnd  = nudgeCooldowns[activePopover.participantId] ?? 0;
            const nCool = nEnd > now;
            const nSecs = nCool ? Math.ceil((nEnd - now) / 1000) : 0;
            const targetId = activePopover.participantId;
            const isTargetCoHost = !!session?.permissions?.coHosts?.[targetId];
            return (
              <div className="popover-items">
                <button className="popover-item" onClick={() => { handleShareETA(popoverP); closePopover(); }}>
                  Share ETA
                </button>
                <button
                  className="popover-item"
                  disabled={nCool}
                  onClick={() => { handleNudge(activePopover.participantId); closePopover(); }}
                  title={nCool ? `Wait ${nSecs}s` : undefined}
                >
                  <MatIcon name="sms" size={16} /> {nCool ? `Nudge (${nSecs}s)` : 'Send Nudge'}
                </button>
                {isViewerHostOrCoHost && targetId !== hostId && !isTargetCoHost && onPromoteCoHost && (
                  <button className="popover-item" onClick={() => { onPromoteCoHost(targetId, popoverP?.name ?? 'Guest'); closePopover(); }}>
                    <MatIcon name="shield_person" size={16} /> Make Co-Host
                  </button>
                )}
                {isViewerHostOrCoHost && isTargetCoHost && onDemoteCoHost && (
                  <button className="popover-item" onClick={() => { onDemoteCoHost(targetId, popoverP?.name ?? 'Guest'); closePopover(); }}>
                    <MatIcon name="person_remove" size={16} /> Remove Co-Host
                  </button>
                )}
              </div>
            );
          })()}

          {activePopover.type === 'overflow-arrived' && (
            <div className="popover-items">
              <button className="popover-item" onClick={() => { handleShareETA(popoverP); closePopover(); }}>
                Share ETA
              </button>
              {activePopover.participantId === currentParticipantId && (
                <button
                  className="popover-item"
                  onClick={() => { onToggleKeepVisible(!popoverP.keepVisible); closePopover(); }}
                >
                  <MatIcon name="location_on" size={16} /> {popoverP.keepVisible ? 'Hide my pin' : 'Keep Visible'}
                </button>
              )}
            </div>
          )}

        </Popover>
      )}

    </div>
  );
}

// ── Pure helpers ──────────────────────────────────────────────────────────────


function etaMs(p, now) {
  let base = null;
  if (p.expectedArrivalTime != null) base = p.expectedArrivalTime;
  else if (p.eta != null)            base = now + p.eta * 1000;
  if (base == null) return null;
  return base + (p.manualDelayMs ?? 0);
}

function smartCountdown(p, now) {
  const ms = etaMs(p, now);
  if (ms == null) return '—';
  const remaining = Math.max(0, ms - now);
  if (remaining <= 0) return 'Arriving now';
  if (remaining < 60_000) return '< 1 min';
  return `${Math.ceil(remaining / 60_000)} min`;
}

function getModeIconName(travelMode) {
  const icons = { DRIVING: 'directions_car', BICYCLING: 'directions_bike', TRANSIT: 'directions_transit', WALKING: 'directions_walk' };
  return icons[travelMode] ?? 'directions_car';
}

function getTransitIconName(vehicleType) {
  const map = { BUS: 'directions_bus', SUBWAY: 'subway', RAIL: 'train', TRAM: 'tram', FERRY: 'directions_boat' };
  return map[vehicleType] ?? 'directions_transit';
}


function formatArrivalTime(arrivalMs) {
  const arrival = new Date(arrivalMs);
  const now = new Date();
  const todayStart   = new Date(now.getFullYear(),     now.getMonth(),     now.getDate());
  const arrivalStart = new Date(arrival.getFullYear(), arrival.getMonth(), arrival.getDate());
  const dayDiff = Math.round((arrivalStart - todayStart) / 86400000);
  const timeStr = arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayDiff <= 0) return timeStr;
  if (dayDiff === 1) return timeStr + ' (+1 day)';
  return timeStr + ' (+' + dayDiff + ' days)';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
