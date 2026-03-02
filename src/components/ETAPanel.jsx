/**
 * ETAPanel — collapsible half-sheet (mobile) / fixed sidebar (desktop).
 *
 * Card layout: strict 4-row grid per participant.
 *   Row 1 : [Avatar] [Name] [Ordinal pill]  ·····  [Mode icon] [ETA countdown]
 *   Row 2 : [Status label]  ···················  [~Arrival time] [·] [Distance]
 *   Row 3 : Warning pills (GPS lost / stale location) — only when relevant
 *   Row 4 : Icon-only action buttons — visibility rules per status & ownership
 *
 * Phase 3 additions:
 *  - Tabbed interface: People | Activity tabs (sticky pinned area)
 *  - 3-point snap: Collapsed (~80px) / Half (~40vh) / Full (~85vh)
 *  - Touch drag from pinned area always; from content area when not at Full
 *  - Scroll locking: content panes scroll only when sheet is at Full
 *  - Unread badge on Activity tab while on People tab
 *
 * Popovers (mode selector, bump options, overflow menus) are rendered via
 * React portals so they escape the panel's overflow clipping.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNow } from '../hooks/useNow';
import { createPortal } from 'react-dom';
import { onValue, ref, query, limitToLast } from 'firebase/database';
import { db } from '../utils/firebase';
import {
  STATUS, MAX_ETA_BUMPS, BUMP_OPTIONS_MINUTES, STATUS_EMOJIS, STALE_THRESHOLD,
  EMOJI_TO_ICON, STATUS_ICONS,
} from '../config/constants';
import { getParticipantColor } from '../utils/participantColor';
import { haversineDistance } from '../utils/geo';
import { haptic } from '../utils/haptic';
import { copyToClipboard } from '../utils/clipboard';
import { timeAgo } from '../utils/formatters';
import MatIcon from './MatIcon';

const NUDGE_COOLDOWN_MS = 60_000;

// Snap geometry constants
const PANEL_TOTAL_VH = 0.85; // panel height = 85% of viewport
const HALF_VH        = 0.40; // half snap = 40% of viewport visible
const COLLAPSED_PX   = 80;   // collapsed: only 80px visible

function getPanelTotalPx()   { return Math.round(window.innerHeight * PANEL_TOTAL_VH); }
function getSnapVisiblePx(snap) {
  if (snap === 'collapsed') return COLLAPSED_PX;
  if (snap === 'half')      return Math.round(window.innerHeight * HALF_VH);
  return getPanelTotalPx(); // full
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

// ─── Status icon helper ───────────────────────────────────────────────────────
function StatusIcon({ statusEmoji, size = 16 }) {
  const iconName = statusEmoji
    ? (EMOJI_TO_ICON[statusEmoji] || statusEmoji)
    : null;
  if (!iconName || !STATUS_ICONS.includes(iconName)) return null;
  return <MatIcon name={iconName} size={size} />;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ETAPanel({
  sessionId,
  participants,
  currentParticipantId,
  hostId = null,
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

  // Activity feed — real-time event log (max 50 events)
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!sessionId) return;
    const q = query(ref(db, `sessions/${sessionId}/events`), limitToLast(50));
    const unsub = onValue(q, (snap) => {
      const list = [];
      snap.forEach((child) => {
        list.push(child.val());
      });
      setEvents(list);
    });
    return () => unsub();
  }, [sessionId]);

  // ── Snap state (mobile only) ─────────────────────────────────────────────
  const [snapPoint, setSnapPoint] = useState('collapsed');
  const snapPointRef = useRef('collapsed');
  function updateSnapPoint(snap) {
    snapPointRef.current = snap;
    setSnapPoint(snap);
  }

  // ── Tab state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('people');
  const activeTabRef = useRef('people');

  // Unread badge: count new events that arrived while on People tab
  const lastSeenCountRef    = useRef(0);
  const hasInitEventsRef    = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (events.length === 0) return;
    if (!hasInitEventsRef.current) {
      // First load — mark all pre-existing events as seen
      lastSeenCountRef.current = events.length;
      hasInitEventsRef.current = true;
      return;
    }
    if (activeTabRef.current !== 'people') return;
    const newEvents = events.length - lastSeenCountRef.current;
    if (newEvents > 0) setUnreadCount(newEvents);
  }, [events.length]);

  function handleTabChange(tab) {
    setActiveTab(tab);
    activeTabRef.current = tab;
    if (tab === 'activity') {
      lastSeenCountRef.current = events.length;
      setUnreadCount(0);
    }
  }

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
    // Mobile: set initial collapsed position (no animation)
    const visible = COLLAPSED_PX;
    const ty = getPanelTotalPx() - visible;
    if (panelRef.current) {
      panelRef.current.style.transition = 'none';
      panelRef.current.style.transform = `translateY(${ty}px)`;
    }
    document.documentElement.style.setProperty('--panel-height', `${visible}px`);
    updateSnapPoint('collapsed');
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
      const inContent = !!e.target.closest('.eta-tab-content-wrapper');
      // Content-area drag only when not at Full (scroll lock means no competing scroll)
      if (!inPinned && !(inContent && snapPointRef.current !== 'full')) return;

      const raw = panel.style.transform;
      const match = raw.match(/translateY\((\d+(?:\.\d+)?)px\)/);
      const currentTY = match ? parseFloat(match[1]) : (getPanelTotalPx() - COLLAPSED_PX);

      dragStartY   = e.touches[0].clientY;
      dragStartVis = getPanelTotalPx() - currentTY;
      isDraggingRef.current = true;
      panel.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const dy         = e.touches[0].clientY - dragStartY;
      const newVisible = Math.max(COLLAPSED_PX, Math.min(getPanelTotalPx(), dragStartVis - dy));
      panel.style.transform = `translateY(${getPanelTotalPx() - newVisible}px)`;
      // Update CSS var continuously so floating controls track in real-time
      document.documentElement.style.setProperty('--panel-height', `${newVisible}px`);
    };

    const onEnd = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const raw = panel.style.transform;
      const match = raw.match(/translateY\((\d+(?:\.\d+)?)px\)/);
      const currentTY  = match ? parseFloat(match[1]) : (getPanelTotalPx() - COLLAPSED_PX);
      const currentVis = getPanelTotalPx() - currentTY;

      const snapOptions = [
        { name: 'collapsed', visible: getSnapVisiblePx('collapsed') },
        { name: 'half',      visible: getSnapVisiblePx('half') },
        { name: 'full',      visible: getSnapVisiblePx('full') },
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
    // Collapsed → half (show participant list); half or full → collapse
    snapToPoint(snapPoint === 'collapsed' ? 'half' : 'collapsed');
  }

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!participants.length) return null;

  // ── Bucket participants ────────────────────────────────────────────────────
  const enRoute        = [];
  const pausedList     = [];
  const arrivedList    = [];
  const waiting        = [];
  const spectatingList = [];

  for (const entry of participants) {
    const s = entry[1].status ?? STATUS.NOT_STARTED;
    if      (s === STATUS.SPECTATING)  spectatingList.push(entry);
    else if (s === STATUS.NOT_STARTED) waiting.push(entry);
    else if (s === STATUS.ARRIVED)     arrivedList.push(entry);
    else if (s === STATUS.PAUSED)      pausedList.push(entry);
    else                               enRoute.push(entry);
  }

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

  const isCooldownActive      = modeSwitchCooldownUntil > now;
  const cooldownSecsRemaining = isCooldownActive ? Math.ceil((modeSwitchCooldownUntil - now) / 1000) : 0;

  // Summary text for collapsed/half views
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

  // Scroll lock: content panes scroll only when fully expanded or in sidebar
  const contentOverflow = (snapPoint === 'full' || isSidebar) ? 'auto' : 'hidden';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={panelRef} className="eta-panel">

      {/* ── Pinned drag area: handle + summary + tab bar ── */}
      <div className="eta-pinned-area">
        {!isSidebar && (
          <div
            className="eta-handle-pill"
            aria-hidden="true"
            onClick={handleHeaderTap}
          />
        )}

        <div
          className="eta-summary"
          onClick={!isSidebar ? handleHeaderTap : undefined}
          onKeyDown={!isSidebar ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHeaderTap(); } } : undefined}
          tabIndex={!isSidebar ? 0 : undefined}
          style={!isSidebar ? { cursor: 'pointer' } : undefined}
          aria-label={!isSidebar ? (snapPoint === 'collapsed' ? 'Expand panel' : 'Collapse panel') : undefined}
          role={!isSidebar ? 'button' : undefined}
        >
          <span className="eta-summary-text">{summaryText}</span>
        </div>

        {/* Tab bar */}
        <div className="eta-tab-bar" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'people'}
            className={`eta-tab-btn${activeTab === 'people' ? ' eta-tab-btn-active' : ''}`}
            onClick={() => handleTabChange('people')}
          >
            People
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'activity'}
            className={`eta-tab-btn${activeTab === 'activity' ? ' eta-tab-btn-active' : ''}`}
            onClick={() => handleTabChange('activity')}
          >
            Activity
            {unreadCount > 0 && (
              <span className="eta-tab-badge" aria-label={`${unreadCount} new`}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Panel-level feedback toast — above tab content, always visible */}
      {feedbackToast && (
        <div className="eta-panel-toast" role="status" aria-live="polite">{feedbackToast}</div>
      )}

      {/* ── Tab content wrapper ── */}
      <div className="eta-tab-content-wrapper">

        {/* ── People tab pane ── */}
        <div
          role="tabpanel"
          aria-label="People"
          className={activeTab === 'people' ? 'eta-tab-pane' : 'eta-tab-pane-hidden'}
          style={{ overflowY: contentOverflow }}
        >
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
            const almostThere = p.status === STATUS.ALMOST_THERE;
            const isCloseRace = closeRaceSet.has(index);
            const activeMode  = p.travelMode ?? 'DRIVING';
            const bumpCount   = p.bumpCount ?? 0;
            const manualDelay = p.manualDelayMs ?? 0;
            const atMaxBumps  = bumpCount >= MAX_ETA_BUMPS;
            const pColor      = colorMap[id];
            const isStale     = !!(p.lastUpdated && (now - p.lastUpdated) > STALE_THRESHOLD);
            const etaMsVal    = etaMs(p, now);
            const hasWarnings = (isMe && gpsLost) || isStale;

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
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="eta-card-name">
                      {p.name}{isMe ? ' (you)' : ''}<StatusIcon statusEmoji={p.statusEmoji} />
                    </span>
                    {id === hostId && <span className="eta-host-chip">Host</span>}
                    {index < 3 && (
                      <span className="eta-ordinal-pill">{ordinal(index + 1)}</span>
                    )}
                    {isCloseRace && (
                      <span className="eta-close-race" aria-label="Close race"><MatIcon name="bolt" size={14} /></span>
                    )}
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-mode"><MatIcon name={getModeIconName(activeMode)} size={20} /></span>
                    <span className="eta-r1-countdown">{smartCountdown(p, now)}</span>
                  </div>
                </div>

                {/* Row 2 */}
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

                {/* Row 4 — action buttons */}
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
                    {STATUS_ICONS.map((iconName, i) => (
                      <button
                        key={iconName}
                        className={`eta-emoji-btn${p.statusEmoji === iconName ? ' eta-emoji-btn-active' : ''}`}
                        onClick={() => {
                          onStatusEmoji(p.statusEmoji === iconName ? null : iconName);
                          setEmojiPickerId(null);
                          haptic(30);
                        }}
                        aria-label={STATUS_EMOJIS[i]?.label ?? iconName}
                        aria-pressed={p.statusEmoji === iconName}
                      ><MatIcon name={iconName} size={20} /></button>
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
            const pColor = colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-paused', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="eta-card-name">
                      {p.name}{isMe ? ' (you)' : ''}<StatusIcon statusEmoji={p.statusEmoji} />
                    </span>
                    {id === hostId && <span className="eta-host-chip">Host</span>}
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
            const pColor = colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-arrived', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="eta-card-name">
                      {p.name}{isMe ? ' (you)' : ''}<StatusIcon statusEmoji={p.statusEmoji} />
                    </span>
                    {id === hostId && <span className="eta-host-chip">Host</span>}
                    <span className="eta-arrived-check" aria-label="arrived"><MatIcon name="check_circle" size={16} fill /></span>
                  </div>
                  <div className="eta-card-r1-right">
                    {p.lastUpdated && (
                      <span className="eta-r1-arrived-time">{formatArrivalTime(p.lastUpdated)}</span>
                    )}
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label">Arrived!</span>
                  <div className="eta-card-r2-right">
                    <button
                      className="eta-overflow-btn"
                      onClick={(e) => { e.stopPropagation(); openPopover('overflow-arrived', id, e.currentTarget); }}
                      title="More options"
                      aria-label={`More options for ${p.name}`}
                    >···</button>
                  </div>
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
            const pColor      = colorMap[id];
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
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="eta-card-name">{p.name}{isMe ? ' (you)' : ''}</span>
                    {id === hostId && <span className="eta-host-chip">Host</span>}
                  </div>
                  <div className="eta-card-r1-right">
                    <span className="eta-r1-countdown eta-r1-muted">—</span>
                  </div>
                </div>
                <div className="eta-card-r2">
                  <span className="eta-status-label">Waiting to start</span>
                  {currentParticipantId && !isMe && (
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
            const pColor = colorMap[id];
            return (
              <div
                key={id}
                className={['eta-card', 'eta-card-spectating', isMe ? 'eta-card-me' : ''].filter(Boolean).join(' ')}
              >
                {/* Row 1 only — ultra-compact; no ETA countdown (spectators have none) */}
                <div className="eta-card-r1">
                  <div className="eta-card-r1-left">
                    <div className="eta-avatar" style={{ background: pColor }} aria-hidden="true">
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="eta-card-name">{p.name}{isMe ? ' (you)' : ''}</span>
                    {id === hostId && <span className="eta-host-chip">Host</span>}
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
        </div>

        {/* ── Activity tab pane ── */}
        <div
          role="tabpanel"
          aria-label="Activity"
          className={activeTab === 'activity' ? 'eta-tab-pane' : 'eta-tab-pane-hidden'}
          style={{ overflowY: contentOverflow }}
        >
          {events.length === 0 ? (
            <div className="eta-activity-empty">No activity yet</div>
          ) : (
            <div className="activity-feed" aria-label="Session activity">
              {[...events].reverse().slice(0, 50).map((evt, i) => (
                <div key={evt.timestamp || i} className="activity-event">
                  <span className="activity-event-text">{formatEvent(evt)}</span>
                  <span className="activity-event-time">{formatArrivalTime(evt.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>{/* end eta-tab-content-wrapper */}

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

function formatEvent(evt) {
  const name = evt.participantName ?? 'Someone';
  const d    = evt.detail;
  switch (evt.type) {
    case 'joined':       return `${name} joined`;
    case 'trip_started': {
      const m = d === 'DRIVING' ? 'driving' : d === 'BICYCLING' ? 'biking'
        : d === 'WALKING' ? 'walking' : d === 'TRANSIT' ? 'on transit' : null;
      return m ? `${name} started ${m}` : `${name} started their trip`;
    }
    case 'eta_bumped':    return `${name} bumped ETA ${d ?? ''}`;
    case 'mode_switched': return `${name} switched to ${d ?? 'new mode'}`;
    case 'paused':        return `${name} paused location sharing`;
    case 'resumed':       return `${name} resumed`;
    case 'arrived':       return `${name} arrived`;
    case 'almost_there':       return `${name} is almost there`;
    case 'left':               return `${name} left the meetup`;
    case 'spectating':         return `${name} is spectating`;
    case 'stopped_spectating': return `${name} stopped spectating`;
    default:                   return `${name} ${evt.type}`;
  }
}

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
