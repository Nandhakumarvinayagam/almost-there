import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, push, onValue } from 'firebase/database';
import { db } from '../utils/firebase';
import { normalizeParticipant } from '../utils/normalizers';
import { detectRegistryLabel } from '../utils/registryLabel';
import { copyToClipboard } from '../utils/clipboard';
import MatIcon from './MatIcon';
import ActivityFeed from './ActivityFeed';
import Poll from './Poll';
import { AvatarIcon } from './Avatars';

/** Format milliseconds until an event as a human-readable string. */
function formatTimeUntil(ms) {
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  return `${hours}h ${rem}m`;
}

/**
 * Lobby — primary view when session.state === 'scheduled'.
 *
 * Layout hierarchy (Section 14, Plan v5):
 *   1. Hero: emoji + event title
 *   2. Scheduled time + location name
 *   3. Guest list: horizontal avatar row grouped by status + headcount summary
 *   4. Logistics cards (dressCode, food, parking, registry)
 *   5. Activity feed
 *   6. Sticky RSVP bar (un-joined users only)
 *
 * Host actions (Section 15, 17, Plan v5):
 *   - Nudge Guests: Web Share / clipboard template. Writes activity feed entry.
 *   - Copy Guest Summary: Plain text export copied to clipboard.
 *
 * Reference: Plan v5, Sections 5, 14, 15, 16, 17
 *
 * @param {object}      props.session        - Normalized session data
 * @param {string}      props.sessionId      - Session ID string
 * @param {string|null} props.participantId  - Current user's participant ID (null if not joined)
 * @param {boolean}     props.isHost         - True if current user is the session host
 * @param {boolean}     props.isCoHost       - True if current user is a co-host
 * @param {function}    props.onJoin         - (name, rsvpStatus, plusOnes) => Promise
 * @param {boolean}     props.joining        - True while onJoin is in flight
 * @param {function}    props.votePoll         - (participantId, optionId, displayName) => Promise
 * @param {function}    props.toggleReaction   - (participantId, logisticKey, emoji, myReactions) => Promise
 * @param {function}    [props.kickParticipant] - (id, name, rsvpStatus, plusOnes) => Promise
 * @param {function}    [props.reclaimHost]     - (participantId, pin) => Promise<{success, error}>
 * @param {function}    [props.showToast]       - (message) => void
 */
export default function Lobby({
  session, sessionId, participantId,
  isHost, isCoHost,
  onJoin, joining,
  votePoll, toggleReaction,
  kickParticipant, reclaimHost,
  showToast,
  onToggleVisibility = () => {},
  onToggleNearby = () => {},
}) {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [rsvpStatus, setRsvpStatus] = useState('going');
  const [plusOnes, setPlusOnes] = useState(0);
  const [anonymousMode, setAnonymousMode] = useState(false);
  const [lobbyAvatarId, setLobbyAvatarId] = useState(null);

  // Kick flow state
  const [selectedParticipant, setSelectedParticipant] = useState(null); // { id, name, rsvpStatus, plusOnes }
  const [kicking, setKicking] = useState(false);

  // Reclaim Host (host recovery) state
  const [showReclaimModal, setShowReclaimModal] = useState(false);
  const [reclaimPin, setReclaimPin] = useState('');
  const [reclaimLoading, setReclaimLoading] = useState(false);
  const [reclaimError, setReclaimError] = useState(null); // 'wrong_pin' | 'write_failed' | null
  const [reclaimSuccess, setReclaimSuccess] = useState(false);
  const [reclaimAttempts, setReclaimAttempts] = useState(0);
  const [reclaimSecondsLeft, setReclaimSecondsLeft] = useState(0);
  const reclaimCooldownRef = useRef(null); // holds the interval ID

  const isHostOrCoHost = isHost || isCoHost;


  // Countdown timer for reclaim PIN rate-limiting (3 wrong attempts → 60s lockout)
  useEffect(() => {
    if (reclaimSecondsLeft <= 0) return;
    const id = setInterval(() => {
      setReclaimSecondsLeft((s) => {
        if (s <= 1) { clearInterval(id); return 0; }
        return s - 1;
      });
    }, 1000);
    reclaimCooldownRef.current = id;
    return () => clearInterval(id);
  }, [reclaimSecondsLeft]);

  // ── Offline indicator (Plan v5, Section 18) ─────────────────────
  // Uses .info/connected — Firebase's special ref that reflects actual RTDB
  // connection state (not just browser online/offline).
  // A 3-second grace period suppresses the false "offline" flash that appears
  // on initial load before Firebase has established its first WebSocket connection.
  // On reconnect, a green "Back online" pill shows for 2 seconds then hides.
  const [firebaseConnected, setFirebaseConnected] = useState(true);
  const [backOnlineFlash, setBackOnlineFlash]     = useState(false);
  const connGraceRef       = useRef(false); // becomes true after 3 s
  const connTimerRef       = useRef(null);  // setTimeout ID for back-online flash
  const prevFirebaseConnRef = useRef(true); // previous connected value

  useEffect(() => {
    const graceTimer = setTimeout(() => { connGraceRef.current = true; }, 3_000);
    const connRef = ref(db, '.info/connected');
    const unsub = onValue(connRef, (snap) => {
      const isConn = snap.val() === true;
      if (!connGraceRef.current) {
        // Still in the grace window — record state but don't update UI
        prevFirebaseConnRef.current = isConn;
        return;
      }
      const wasConn = prevFirebaseConnRef.current;
      prevFirebaseConnRef.current = isConn;
      setFirebaseConnected(isConn);
      if (isConn && !wasConn) {
        // Just reconnected — flash "Back online" for 2 s
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

  // ── Add to Calendar: Google Calendar deep link ────────────────────
  // Converts epoch-ms scheduledTime to YYYYMMDDTHHmmSSZ format required by Google Calendar.
  // Duration fixed at 2 hours (matching expiresAt logic). (Plan v5, Section 14)
  const calendarUrl = useMemo(() => {
    if (!session?.scheduledTime) return null;
    const start = new Date(session.scheduledTime);
    const end   = new Date(session.scheduledTime + 2 * 60 * 60 * 1000);
    const fmt   = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const title = session?.nickname || session?.destination?.name || 'Meetup';
    const loc   = session?.destination?.address || '';
    const descParts = [];
    if (session?.notes) descParts.push(session.notes);
    descParts.push('RSVP here: ' + window.location.href);
    return (
      `https://calendar.google.com/calendar/event?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${fmt(start)}/${fmt(end)}` +
      `&location=${encodeURIComponent(loc)}` +
      `&details=${encodeURIComponent(descParts.join('\n\n'))}`
    );
  }, [session?.scheduledTime, session?.nickname, session?.destination, session?.notes]);

  // Normalize all participant entries
  const participants = useMemo(() => {
    if (!session?.participants) return [];
    return Object.entries(session.participants).map(([id, p]) => [id, normalizeParticipant(p)]);
  }, [session?.participants]);

  const going   = participants.filter(([, p]) => p.rsvpStatus === 'going');
  const maybe   = participants.filter(([, p]) => p.rsvpStatus === 'maybe');
  const cantGo  = participants.filter(([, p]) => p.rsvpStatus === 'cant-go');

  const plusOnesTotal = going.reduce((sum, [, p]) => sum + (p.plusOnes || 0), 0);
  const goingCount    = going.length + plusOnesTotal;

  const hasJoined    = !!participantId && participants.some(([id]) => id === participantId);
  const myParticipant = participantId ? participants.find(([id]) => id === participantId)?.[1] : null;

  const scheduledDisplay = session?.scheduledTime
    ? new Date(session.scheduledTime).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : null;

  const isTransitioning =
    session?.scheduledTime && Date.now() > session.scheduledTime;

  const logistics = session?.logistics || {};

  // ── Nudge Guests (Section 15) ──────────────────────────────────
  async function handleNudge() {
    const title = session?.nickname || session?.destination?.name || 'Meetup';
    const timeMs = session?.scheduledTime;
    const timeUntil = timeMs ? formatTimeUntil(timeMs - Date.now()) : null;
    const time = timeMs
      ? new Date(timeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null;
    const locationName = session?.destination?.name || '';
    const url = window.location.href;

    const parts = [`Hey! 🎉 ${title}${timeUntil ? ` is ${timeUntil} away` : ''}.`];
    if (locationName) parts.push(`📍 ${locationName}`);
    if (time) parts.push(`🕐 ${time}`);
    parts.push(`\nRSVP here: ${url}`);
    const text = parts.join('\n');

    let shared = false;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        shared = true;
      } catch {
        // User cancelled — fall through to clipboard
      }
    }
    if (!shared) {
      try {
        await copyToClipboard(text);
        showToast?.('Invite copied to clipboard!');
      } catch {
        showToast?.('Could not copy invite');
      }
    }

    // Activity feed entry — non-critical
    const displayName =
      myParticipant?.visibility === 'hidden' ? 'Someone' : (myParticipant?.name || 'Host');
    try {
      await push(ref(db, `sessions/${sessionId}/activityFeed`), {
        type: 'nudge',
        userId: participantId,
        text: `${displayName} sent a nudge to guests`,
        timestamp: Date.now(),
      });
    } catch {
      // Non-critical
    }
  }

  // ── Share Invite — visible to all joined participants ──────────
  // Simple share/copy without the activity feed entry (that's for Nudge only).
  async function handleShare() {
    const title = session?.nickname || session?.destination?.name || 'Meetup';
    const shareData = {
      title,
      text: `Join "${title}" on Almost There`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await copyToClipboard(shareData.text + ': ' + shareData.url);
        showToast?.('Invite link copied!');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        try {
          await copyToClipboard(window.location.href);
          showToast?.('Invite link copied!');
        } catch {
          showToast?.('Could not share invite');
        }
      }
    }
  }

  // ── Guest Summary Export (Section 17) ─────────────────────────
  async function handleExport() {
    const title = session?.nickname || session?.destination?.name || 'Meetup';
    const lines = [`${title} — Guest Summary`];

    const parts = [];
    if (goingCount > 0) {
      parts.push(`${goingCount} going${plusOnesTotal > 0 ? ` (including ${plusOnesTotal} guest${plusOnesTotal !== 1 ? 's' : ''})` : ''}`);
    }
    if (maybe.length > 0) parts.push(`${maybe.length} maybe`);
    if (cantGo.length > 0) parts.push(`${cantGo.length} can't go`);
    if (parts.length > 0) lines.push(parts.join(' · '));

    const formatEntry = ([, p]) => {
      const displayName = p.visibility === 'hidden' ? 'Anonymous Guest' : p.name;
      let line = `• ${displayName}`;
      if (p.plusOnes > 0) line += ` (+${p.plusOnes})`;
      if (p.guestNote) line += ` — "${p.guestNote}"`;
      return line;
    };

    if (going.length > 0) {
      lines.push('');
      lines.push('GOING:');
      going.forEach((entry) => lines.push(formatEntry(entry)));
    }
    if (maybe.length > 0) {
      lines.push('');
      lines.push('MAYBE:');
      maybe.forEach((entry) => lines.push(formatEntry(entry)));
    }
    if (cantGo.length > 0) {
      lines.push('');
      lines.push("CAN'T GO:");
      cantGo.forEach((entry) => lines.push(formatEntry(entry)));
    }

    try {
      await copyToClipboard(lines.join('\n').trim());
      showToast?.('Guest summary copied!');
    } catch {
      showToast?.('Could not copy summary');
    }
  }

  // ── Kick (Section 7) ─────────────────────────────────────────────
  async function handleKickConfirm() {
    if (!selectedParticipant || !kickParticipant) return;
    setKicking(true);
    try {
      await kickParticipant(
        selectedParticipant.id,
        selectedParticipant.name,
        selectedParticipant.rsvpStatus,
        selectedParticipant.plusOnes,
      );
      showToast?.(`${selectedParticipant.name} was removed.`);
    } catch {
      showToast?.('Failed to remove guest. Try again.');
    } finally {
      setKicking(false);
      setSelectedParticipant(null);
    }
  }

  // ── Host Recovery PIN (Section 6) ────────────────────────────────
  async function handleReclaimSubmit(e) {
    e.preventDefault();
    if (!reclaimHost || reclaimSecondsLeft > 0) return;
    setReclaimLoading(true);
    setReclaimError(null);

    const result = await reclaimHost(participantId, reclaimPin);
    setReclaimLoading(false);

    if (result.success) {
      setReclaimSuccess(true);
      setReclaimAttempts(0);
      return;
    }

    if (result.error === 'wrong_pin') {
      const newAttempts = reclaimAttempts + 1;
      setReclaimAttempts(newAttempts);
      setReclaimError('wrong_pin');
      if (newAttempts >= 3) {
        setReclaimSecondsLeft(60);
      }
    } else if (result.error === 'no_hash') {
      setReclaimError('no_hash');
    } else {
      setReclaimError('write_failed');
    }
    setReclaimPin('');
  }

  function openReclaimModal() {
    setReclaimPin('');
    setReclaimError(null);
    setReclaimSuccess(false);
    setReclaimAttempts(0);
    setReclaimSecondsLeft(0);
    setShowReclaimModal(true);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onJoin(trimmed, rsvpStatus, plusOnes, anonymousMode ? 'hidden' : 'visible', lobbyAvatarId);
    setShowModal(false);
  };

  const rsvpLabel = (status) =>
    status === 'going' ? 'Going' : status === 'maybe' ? 'Maybe' : "Can't Go";

  return (
    <div className="lobby" style={{ position: 'relative' }}>
      {/* ── Back to home button ── */}
      <button
        className="lobby-back-btn"
        onClick={() => navigate('/')}
        aria-label="Back to home"
      >
        <MatIcon name="arrow_back" size={22} />
      </button>

      {/* ── Offline / Back-online banners (Plan v5, Section 18) ── */}
      {!firebaseConnected && (
        <div className="lobby-offline-banner" role="alert" aria-live="assertive">
          <MatIcon name="wifi_off" size={14} />
          Offline
        </div>
      )}
      {backOnlineFlash && (
        <div className="lobby-online-banner" role="status" aria-live="polite">
          ✓ Back online
        </div>
      )}

      {/* Ghost transition banner */}
      {isTransitioning && (
        <div className="lobby-transitioning" role="status">
          <MatIcon name="radio_button_checked" size={12} />
          Starting…
        </div>
      )}

      <div className="lobby-scroll">

        {/* ── 1. Hero ── */}
        <div className="lobby-hero">
          <div className="lobby-emoji hero-emoji-aura" aria-hidden="true">
            {session?.theme?.emoji || '📍'}
          </div>
          <h1 className="lobby-title">
            {session?.nickname || session?.destination?.name || 'Meetup'}
          </h1>
          <div className="lobby-meta">
            {scheduledDisplay && (
              <span className="lobby-meta-item">
                <MatIcon name="schedule" size={16} />
                {scheduledDisplay}
              </span>
            )}
            {session?.destination?.name && (
              <span className="lobby-meta-item">
                <MatIcon name="location_on" size={16} />
                {session.destination.name}
              </span>
            )}
            {/* Add to Calendar — Google Calendar deep link (Plan v5, Section 14) */}
            {calendarUrl && (
              <a
                href={calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="lobby-calendar-link"
                aria-label="Add to Google Calendar"
              >
                <MatIcon name="event" size={14} />
                Add to Calendar
              </a>
            )}
          </div>
        </div>

        {/* ── Share Invite — visible to all joined participants ── */}
        {hasJoined && (
          <div className="lobby-host-actions">
            <button
              type="button"
              className="lobby-host-action-btn lobby-share-btn"
              onClick={handleShare}
              aria-label="Share invite link"
            >
              <MatIcon name="share" size={18} />
              Share Invite
            </button>
            {/* Nudge Guests — host/co-host only, shown when guests exist */}
            {isHostOrCoHost && participants.length > 0 && (
              <button
                type="button"
                className="lobby-host-action-btn"
                onClick={handleNudge}
                aria-label="Nudge guests"
              >
                <MatIcon name="notifications_active" size={18} />
                Nudge
              </button>
            )}
            {isHostOrCoHost && (
              <button
                type="button"
                className="lobby-host-action-btn"
                onClick={handleExport}
                aria-label="Copy guest summary"
              >
                <MatIcon name="content_copy" size={18} />
                Copy Guest List
              </button>
            )}
          </div>
        )}

        {/* ── 2. Guest list + headcount ── */}
        {participants.length > 0 && (
          <div className="lobby-section">
            <div className="lobby-guests-scroll" role="list" aria-label="Guest list">
              {going.map(([id, p]) => (
                <Avatar
                  key={id}
                  name={p.visibility === 'hidden' ? (isHostOrCoHost ? p.name : 'Anonymous Guest') : p.name}
                  rsvpStatus="going"
                  isNearby={!!p.nearbyStatus}
                  canRemove={isHostOrCoHost && id !== participantId}
                  showHiddenBadge={p.visibility === 'hidden' && isHostOrCoHost}
                  avatarId={p.avatarId}
                  onClick={isHostOrCoHost && id !== participantId ? () => setSelectedParticipant({ id, name: p.name, rsvpStatus: p.rsvpStatus, plusOnes: p.plusOnes }) : undefined}
                />
              ))}
              {maybe.map(([id, p]) => (
                <Avatar
                  key={id}
                  name={p.visibility === 'hidden' ? (isHostOrCoHost ? p.name : 'Anonymous Guest') : p.name}
                  rsvpStatus="maybe"
                  isNearby={!!p.nearbyStatus}
                  canRemove={isHostOrCoHost && id !== participantId}
                  showHiddenBadge={p.visibility === 'hidden' && isHostOrCoHost}
                  avatarId={p.avatarId}
                  onClick={isHostOrCoHost && id !== participantId ? () => setSelectedParticipant({ id, name: p.name, rsvpStatus: p.rsvpStatus, plusOnes: p.plusOnes }) : undefined}
                />
              ))}
              {cantGo.map(([id, p]) => (
                <Avatar
                  key={id}
                  name={p.visibility === 'hidden' ? (isHostOrCoHost ? p.name : 'Anonymous Guest') : p.name}
                  rsvpStatus="cant-go"
                  isNearby={!!p.nearbyStatus}
                  canRemove={isHostOrCoHost && id !== participantId}
                  showHiddenBadge={p.visibility === 'hidden' && isHostOrCoHost}
                  avatarId={p.avatarId}
                  onClick={isHostOrCoHost && id !== participantId ? () => setSelectedParticipant({ id, name: p.name, rsvpStatus: p.rsvpStatus, plusOnes: p.plusOnes }) : undefined}
                />
              ))}
            </div>

            <div className="lobby-headcount">
              {goingCount > 0 && (
                <span className="lobby-headcount-going">
                  {goingCount} going
                  {plusOnesTotal > 0 && ` (including ${plusOnesTotal} guest${plusOnesTotal > 1 ? 's' : ''})`}
                </span>
              )}
              {maybe.length > 0 && <span className="lobby-headcount-sep">·</span>}
              {maybe.length > 0 && (
                <span className="lobby-headcount-maybe">{maybe.length} maybe</span>
              )}
              {cantGo.length > 0 && <span className="lobby-headcount-sep">·</span>}
              {cantGo.length > 0 && (
                <span className="lobby-headcount-cantgo">{cantGo.length} can't go</span>
              )}
            </div>
          </div>
        )}

        {/* ── My RSVP status chip ── */}
        {hasJoined && myParticipant && (
          <div className="lobby-my-rsvp">
            <span className="lobby-my-rsvp-label">You're</span>
            <span className={`lobby-my-rsvp-status lobby-rsvp-${myParticipant.rsvpStatus}`}>
              {rsvpLabel(myParticipant.rsvpStatus)}
            </span>
            {myParticipant.plusOnes > 0 && (
              <span className="lobby-my-rsvp-plus">
                +{myParticipant.plusOnes}
              </span>
            )}
          </div>
        )}

        {/* ── "You're in hidden mode" chip (Section 11) ── */}
        {hasJoined && myParticipant?.visibility === 'hidden' && (
          <div className="lobby-hidden-mode" role="status">
            <MatIcon name="visibility_off" size={16} />
            <span className="lobby-hidden-mode-text">
              You're in hidden mode — your name appears as Anonymous Guest
            </span>
            <button
              type="button"
              className="lobby-hidden-mode-toggle"
              onClick={() => onToggleVisibility('visible')}
            >
              Go visible
            </button>
          </div>
        )}

        {/* ── "I reached" button — self-report arriving early at the venue ── */}
        {hasJoined && myParticipant && (
          <button
            type="button"
            className={`lobby-reached-btn${myParticipant.nearbyStatus ? ' active' : ''}`}
            onClick={() => onToggleNearby(!myParticipant.nearbyStatus)}
            aria-pressed={!!myParticipant.nearbyStatus}
          >
            {myParticipant.nearbyStatus ? "I'm here ✓" : "I'm already here"}
          </button>
        )}

        {/* ── Reclaim Host link (Section 6) — visible to joined non-hosts/non-co-hosts when a recovery PIN was set ── */}
        {hasJoined && !isHost && !isCoHost && session?.hostSecretHash && (
          <div className="lobby-reclaim-host">
            <button
              type="button"
              className="lobby-reclaim-btn"
              onClick={openReclaimModal}
              aria-label="Reclaim host access"
            >
              <MatIcon name="admin_panel_settings" size={16} />
              Reclaim Host Access
            </button>
          </div>
        )}

        {/* ── 3. Logistics cards ── */}
        {logistics.dressCode && (
          <LogisticsCard
            icon="checkroom" label="Dress Code" value={logistics.dressCode}
            logisticKey="dressCode"
            reactions={session?.reactions?.dressCode}
            myReactions={myParticipant?.myReactions}
            hasJoined={hasJoined}
            onReact={(key, emoji) => toggleReaction?.(participantId, key, emoji, myParticipant?.myReactions)}
          />
        )}
        {logistics.food && (
          <LogisticsCard
            icon="restaurant" label="Food" value={logistics.food}
            logisticKey="food"
            reactions={session?.reactions?.food}
            myReactions={myParticipant?.myReactions}
            hasJoined={hasJoined}
            onReact={(key, emoji) => toggleReaction?.(participantId, key, emoji, myParticipant?.myReactions)}
          />
        )}
        {logistics.parking && (
          <LogisticsCard
            icon="local_parking" label="Parking" value={logistics.parking}
            logisticKey="parking"
            reactions={session?.reactions?.parking}
            myReactions={myParticipant?.myReactions}
            hasJoined={hasJoined}
            onReact={(key, emoji) => toggleReaction?.(participantId, key, emoji, myParticipant?.myReactions)}
          />
        )}
        {logistics.registry && (
          <RegistryCard url={logistics.registry} />
        )}

        {/* ── 4. Poll ── */}
        {session?.poll && (
          <Poll
            poll={session.poll}
            myVote={myParticipant?.pollVote || null}
            hasJoined={hasJoined}
            onVote={async (optionId) => {
              const displayName =
                myParticipant?.visibility === 'hidden' ? 'Someone' : myParticipant?.name || 'Someone';
              try {
                await votePoll?.(participantId, optionId, displayName);
              } catch (err) {
                console.error('Poll vote failed:', err);
                showToast?.('Could not save vote — try again');
              }
            }}
          />
        )}

        {/* ── 5. Activity feed ── */}
        <ActivityFeed sessionId={sessionId} variant="lobby" maxDisplay={20} />

        <div style={{ height: '80px' }} />
      </div>

      {/* ── Sticky RSVP bar (un-joined users only) ── */}
      {!hasJoined && (
        <div className="lobby-rsvp-bar">
          <button
            className="btn lobby-rsvp-btn"
            onClick={() => setShowModal(true)}
          >
            RSVP to this meetup
          </button>
        </div>
      )}

      {/* ── Kick confirmation dialog (Section 7) ── */}
      {selectedParticipant && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Remove guest">
          <div className="prompt-card">
            <h3>Remove Guest</h3>
            <p className="prompt-subtitle">
              Remove {selectedParticipant.name}? They won't be able to rejoin.
            </p>
            <div className="prompt-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelectedParticipant(null)}
                disabled={kicking}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleKickConfirm}
                disabled={kicking}
              >
                {kicking ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reclaim Host PIN modal (Section 6) ── */}
      {showReclaimModal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Reclaim host access">
          <div className="prompt-card">
            <h3>Reclaim Host Access</h3>
            {reclaimSuccess ? (
              <>
                <p className="prompt-subtitle reclaim-success">
                  <MatIcon name="check_circle" size={18} />
                  Co-host access granted! You now have host privileges.
                </p>
                <div className="prompt-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowReclaimModal(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleReclaimSubmit} autoComplete="off">
                <p className="prompt-subtitle">
                  Enter your 4-digit recovery PIN to reclaim host access.
                </p>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  placeholder="4-digit PIN"
                  value={reclaimPin}
                  onChange={(e) => setReclaimPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  disabled={reclaimLoading || reclaimSecondsLeft > 0}
                  autoFocus
                  aria-label="Recovery PIN"
                />
                {reclaimError === 'wrong_pin' && reclaimSecondsLeft === 0 && (
                  <p className="error-msg" role="alert">Incorrect PIN.</p>
                )}
                {reclaimSecondsLeft > 0 && (
                  <p className="error-msg" role="alert">
                    Too many attempts. Try again in {reclaimSecondsLeft}s.
                  </p>
                )}
                {reclaimError === 'write_failed' && (
                  <p className="error-msg" role="alert">
                    Couldn't save. Check your connection and try again.
                  </p>
                )}
                <div className="prompt-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShowReclaimModal(false)}
                    disabled={reclaimLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={reclaimPin.length !== 4 || reclaimLoading || reclaimSecondsLeft > 0}
                  >
                    {reclaimLoading ? 'Verifying…' : 'Confirm'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── RSVP modal ── */}
      {showModal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="RSVP">
          <div className="prompt-card">
            <h3>RSVP</h3>
            <p className="prompt-subtitle">
              {session?.nickname || session?.destination?.name || 'Meetup'}
            </p>

            <form onSubmit={handleSubmit} autoComplete="off">
              <input
                className="input"
                type="text"
                id="lobby_name_input"
                name="lobby_display_name"
                autoComplete="off"
                autoCorrect="off"
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={30}
                aria-label="Your name"
                required
              />

              {/* Avatar picker */}
              <AvatarPicker selected={lobbyAvatarId} onSelect={setLobbyAvatarId} />

              <div className="lobby-rsvp-options" role="group" aria-label="RSVP status">
                {RSVP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`lobby-rsvp-option${rsvpStatus === opt.value ? ' lobby-rsvp-option-selected' : ''}`}
                    onClick={() => setRsvpStatus(opt.value)}
                    aria-pressed={rsvpStatus === opt.value}
                  >
                    <MatIcon name={opt.icon} size={18} />
                    {opt.label}
                  </button>
                ))}
              </div>

              {rsvpStatus === 'going' && (
                <div className="lobby-plusones">
                  <span className="lobby-plusones-label">Plus ones</span>
                  <div className="lobby-plusones-stepper">
                    <button
                      type="button"
                      className="lobby-stepper-btn"
                      onClick={() => setPlusOnes(Math.max(0, plusOnes - 1))}
                      disabled={plusOnes === 0}
                      aria-label="Decrease plus ones"
                    >
                      <MatIcon name="remove" size={18} />
                    </button>
                    <span className="lobby-plusones-val" aria-live="polite">{plusOnes}</span>
                    <button
                      type="button"
                      className="lobby-stepper-btn"
                      onClick={() => setPlusOnes(Math.min(5, plusOnes + 1))}
                      disabled={plusOnes === 5}
                      aria-label="Increase plus ones"
                    >
                      <MatIcon name="add" size={18} />
                    </button>
                  </div>
                </div>
              )}

              {/* Anonymous mode toggle */}
              <div className="join-anonymous-row">
                <div className="join-anonymous-left">
                  <span className="join-anonymous-label">
                    <MatIcon name="visibility_off" size={16} />
                    Join anonymously
                  </span>
                  {anonymousMode && (
                    <span className="join-anonymous-hint">
                      Others will see you as "Anonymous Guest"
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`join-anonymous-toggle${anonymousMode ? ' join-anonymous-toggle-on' : ''}`}
                  onClick={() => setAnonymousMode((v) => !v)}
                  aria-pressed={anonymousMode}
                  aria-label="Join anonymously"
                >
                  {anonymousMode ? 'On' : 'Off'}
                </button>
              </div>

              <div className="prompt-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowModal(false)}
                  disabled={joining}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!name.trim() || joining}
                >
                  {joining ? 'Saving…' : 'Confirm RSVP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Internal sub-components ──────────────────────────────────────

const RSVP_STATUS_COLORS = {
  going:     '#22c55e',
  maybe:     '#f59e0b',
  'cant-go': '#ef4444',
};

const RSVP_OPTIONS = [
  { value: 'going',    label: 'Going',     icon: 'check_circle' },
  { value: 'maybe',   label: 'Maybe',     icon: 'help'         },
  { value: 'cant-go', label: "Can't Go",  icon: 'cancel'       },
];

function Avatar({ name, rsvpStatus, isNearby = false, canRemove, onClick, showHiddenBadge = false, avatarId }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const avatarContent = avatarId != null ? <AvatarIcon avatarId={avatarId} size={24} /> : initials;

  const reachedTitle = isNearby ? ' · at the venue' : '';
  const hiddenTitle = showHiddenBadge ? ' (hidden)' : '';
  const extraClasses = [
    showHiddenBadge ? 'lobby-avatar-hidden' : '',
    isNearby       ? 'lobby-avatar-nearby'  : '',
  ].filter(Boolean).join(' ');

  if (canRemove && onClick) {
    return (
      <button
        type="button"
        className={`lobby-avatar lobby-avatar-removable${extraClasses ? ` ${extraClasses}` : ''}`}
        style={{ background: RSVP_STATUS_COLORS[rsvpStatus] || '#94a3b8' }}
        title={`${name}${hiddenTitle}${reachedTitle} — tap to remove`}
        aria-label={`${name}${hiddenTitle}${reachedTitle}, tap to remove`}
        onClick={onClick}
      >
        {avatarContent}
        {showHiddenBadge && <span className="lobby-avatar-hidden-dot" aria-hidden="true" />}
        {isNearby && <span className="lobby-avatar-reached-badge" aria-hidden="true">🏁</span>}
      </button>
    );
  }

  return (
    <div
      className={`lobby-avatar${extraClasses ? ` ${extraClasses}` : ''}`}
      style={{ background: RSVP_STATUS_COLORS[rsvpStatus] || '#94a3b8' }}
      title={`${name}${hiddenTitle}${reachedTitle}`}
      role="listitem"
      aria-label={`${name}${hiddenTitle}${reachedTitle}`}
    >
      {avatarContent}
      {showHiddenBadge && <span className="lobby-avatar-hidden-dot" aria-hidden="true" />}
      {isNearby && <span className="lobby-avatar-reached-badge" aria-hidden="true">🏁</span>}
    </div>
  );
}

const REACTION_EMOJIS = ['🔥', '❤️', '👍', '😂'];

function LogisticsCard({ icon, label, value, logisticKey, reactions, myReactions, hasJoined, onReact }) {
  return (
    <div className="lobby-card">
      <div className="lobby-card-header">
        <MatIcon name={icon} size={18} />
        <span className="lobby-card-label">{label}</span>
      </div>
      <p className="lobby-card-value">{value}</p>
      {hasJoined && (
        <div className="lobby-card-reactions" aria-label={`Reactions for ${label}`}>
          {REACTION_EMOJIS.map((emoji) => {
            const reactionKey = `${logisticKey}_${emoji}`;
            const count = reactions?.[emoji] || 0;
            const tapped = !!myReactions?.[reactionKey];
            return (
              <button
                key={emoji}
                className={`reaction-btn${tapped ? ' reaction-btn-active' : ''}`}
                onClick={() => onReact(logisticKey, emoji)}
                aria-label={`${emoji}${count > 0 ? ` ${count}` : ''}`}
                aria-pressed={tapped}
              >
                {emoji}
                {count > 0 && <span className="reaction-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RegistryCard({ url }) {
  const reg = detectRegistryLabel(url);
  return (
    <div className="lobby-card">
      <div className="lobby-card-header">
        <MatIcon name="card_giftcard" size={18} />
        <span className="lobby-card-label">Registry</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="lobby-registry-chip"
      >
        <MatIcon name={reg?.icon || 'link'} size={16} />
        {reg?.label || 'Link'}
      </a>
    </div>
  );
}
