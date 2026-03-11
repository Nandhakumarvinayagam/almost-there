/**
 * SessionRecap — full-screen overlay shown to all participants when the host
 * ends the meetup (session.status === 'completed' or session.state === 'completed').
 *
 * Shows:
 *   - Group stats: total participants, total distance, event duration, first to arrive
 *   - 🥇 First to arrive / 🏁 Last to arrive (if 2+ arrived)
 *   - 🐢 Most delayed (if any manual bumps were used)
 *   - 📊 Trip times for every participant who arrived
 *   - Event Details (logistics) — collapsible, Social Edition only
 *   - Poll results — read-only, Social Edition only
 *   - Guest summary — grouped by final status, Social Edition only
 *   - ✨ Highlight Memory: each participant submits a one-line note or URL
 *   - A "Done" button that navigates home
 *
 * Plan v5, Phase 4, Steps 1–2. Phase 3, Step 3.4.
 */
import { useMemo, useState, useCallback } from 'react';
import { STATUS } from '../config/constants';
import { getParticipantColor } from '../utils/participantColor';
import MatIcon from './MatIcon';

/** Format a millisecond duration as "X min" or "X hr Y min". */
function formatDuration(ms) {
  if (ms <= 0) return '< 1 min';
  const totalMins = Math.round(ms / 60_000);
  if (totalMins < 1)  return '< 1 min';
  if (totalMins < 60) return `${totalMins} min`;
  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hrs} hr` : `${hrs} hr ${mins} min`;
}

/** Format a Unix timestamp as a local clock time, e.g. "3:04 PM". */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Format metres into a human-readable distance string. */
function formatDistance(meters) {
  if (!meters || meters <= 0) return null;
  const useImperial = /^en-(US|GB|MM)/.test(navigator.language);
  if (useImperial) {
    const miles = meters / 1609.344;
    return miles < 0.1 ? '< 0.1 mi' : miles.toFixed(1) + ' mi';
  }
  const km = meters / 1000;
  return km < 0.1 ? '< 0.1 km' : km.toFixed(1) + ' km';
}

/** Detect whether a string looks like a URL. */
function isURL(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function SessionRecap({ session, participants, destination, onDone, myParticipantId, onSaveMemory, isHost, onClone }) {
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Stable color map keyed by participant ID
  const colorMap = useMemo(() => {
    const map = {};
    participants.forEach(([id, p], i) => { map[id] = getParticipantColor(p, i); });
    return map;
  }, [participants]);

  // Active travelers only — spectators excluded from arrival/duration/podium
  const travelers = useMemo(() =>
    participants.filter(([, p]) => p.status !== STATUS.SPECTATING),
    [participants]
  );

  const spectatorList = useMemo(() =>
    participants.filter(([, p]) => p.status === STATUS.SPECTATING),
    [participants]
  );

  // Arrived participants sorted earliest → latest arrival
  const arrivedList = useMemo(() =>
    travelers
      .filter(([, p]) => p.status === STATUS.ARRIVED && p.tripStartedAt)
      .sort(([, a], [, b]) => (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0)),
    [travelers]
  );

  // Most manual ETA bumps (🐢)
  const mostDelayed = useMemo(() => {
    const withDelay = travelers
      .filter(([, p]) => (p.manualDelayMs ?? 0) > 0)
      .sort(([, a], [, b]) => (b.manualDelayMs ?? 0) - (a.manualDelayMs ?? 0));
    return withDelay[0] ?? null;
  }, [travelers]);

  // ── Group stats ──────────────────────────────────────────────────────────────

  // Total distance: sum routeDistanceMeters for all travelers who have a value
  const totalDistanceMeters = useMemo(() => {
    const sum = travelers.reduce((acc, [, p]) => acc + (p.routeDistanceMeters ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [travelers]);

  // Event duration: from the earliest trip start to the latest arrival
  const eventDurationMs = useMemo(() => {
    const starts = travelers.map(([, p]) => p.tripStartedAt).filter(Boolean);
    const ends   = arrivedList.map(([, p]) => p.lastUpdated).filter(Boolean);
    if (starts.length === 0 || ends.length === 0) return null;
    return Math.max(...ends) - Math.min(...starts);
  }, [travelers, arrivedList]);

  // ── Highlight Memories ───────────────────────────────────────────────────────

  const memories = useMemo(() =>
    participants
      .filter(([, p]) => p.highlightMemory)
      .map(([id, p]) => ({ id, name: p.name, memory: p.highlightMemory, color: colorMap[id] })),
    [participants, colorMap]
  );

  const myMemory = useMemo(() => {
    if (!myParticipantId) return null;
    const mine = participants.find(([id]) => id === myParticipantId);
    return mine?.[1]?.highlightMemory ?? null;
  }, [participants, myParticipantId]);

  const handleSaveMemory = useCallback(async () => {
    if (!onSaveMemory || !memoryDraft.trim()) return;
    setMemorySaving(true);
    try {
      await onSaveMemory(memoryDraft.trim());
      setMemoryDraft('');
    } finally {
      setMemorySaving(false);
    }
  }, [onSaveMemory, memoryDraft]);

  // ── Social Edition extras ────────────────────────────────────────────────────

  // Logistics — only show section if at least one field is non-null
  const logistics = session?.logistics ?? {};
  const hasLogistics = !!(logistics.dressCode || logistics.food || logistics.parking || logistics.registry);

  // Poll results
  const poll = session?.poll;
  const pollOptions = useMemo(() => {
    if (!poll?.options) return [];
    return Object.entries(poll.options);
  }, [poll]);
  const totalPollVotes = useMemo(() =>
    pollOptions.reduce((sum, [, o]) => sum + (o.votes || 0), 0),
    [pollOptions]
  );
  const hasPoll = !!(poll?.question && pollOptions.length > 0);

  // Gate Social Edition extras — only show for sessions that have
  // scheduling, logistics, or a poll (not legacy MVP sessions).
  const isSocialEdition = !!(session?.scheduledTime || session?.logistics || session?.poll);

  // Guest summary — grouped by final participant status
  const guestSummary = useMemo(() => {
    if (!isSocialEdition) return null;
    const arrived = [];
    const enRoute = [];
    const maybe   = [];
    const cantGo  = [];

    participants.forEach(([, p]) => {
      if (p.status === STATUS.SPECTATING) return; // spectators shown separately
      const displayName = p.visibility === 'hidden' ? 'Anonymous Guest' : (p.name || '?');
      const plusOnes = p.plusOnes || 0;
      const label = plusOnes > 0 ? `${displayName} (+${plusOnes})` : displayName;

      if (p.status === STATUS.ARRIVED) {
        arrived.push(label);
      } else if (p.rsvpStatus === 'cant-go') {
        cantGo.push(label);
      } else if (p.rsvpStatus === 'maybe') {
        maybe.push(label);
      } else {
        // going but session ended before they arrived
        enRoute.push(label);
      }
    });

    return { arrived, enRoute, maybe, cantGo };
  }, [participants, isSocialEdition]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const destName = session?.nickname || destination?.name || destination?.address || 'Meetup';
  const showPodium = arrivedList.length >= 2;
  const firstToArrive = arrivedList[0] ?? null;
  const lastToArrive  = arrivedList.length >= 2 ? arrivedList[arrivedList.length - 1] : null;

  // First arrival trip duration for the stats row
  const firstArrivalTripMs = firstToArrive && firstToArrive[1].tripStartedAt && firstToArrive[1].lastUpdated
    ? firstToArrive[1].lastUpdated - firstToArrive[1].tripStartedAt
    : null;

  // Hero icon: theme emoji (Social Edition) or generic flag (legacy)
  const heroEmoji = session?.theme?.emoji || null;

  return (
    <div
      className="session-recap-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Meetup recap"
      style={{ position: 'fixed', zIndex: 300 }}
    >
      <div className="session-recap-card">

        {/* ── Header ── */}
        <div className="session-recap-header">
          {heroEmoji ? (
            <span className="session-recap-hero-emoji hero-emoji-aura" aria-hidden="true">
              {heroEmoji}
            </span>
          ) : (
            <span className="session-recap-icon" aria-hidden="true"><MatIcon name="flag" size={40} fill /></span>
          )}
          <h2 className="session-recap-title">Meetup ended</h2>
          <p className="session-recap-subtitle">{destName}</p>
        </div>

        {/* ── Group stats ── */}
        <div className="session-recap-stats" aria-label="Group stats">
          <div className="session-recap-stat">
            <span className="session-recap-stat-value">{participants.length}</span>
            <span className="session-recap-stat-label">
              {participants.length === 1 ? 'person' : 'people'}
            </span>
          </div>
          {totalDistanceMeters != null && (
            <div className="session-recap-stat">
              <span className="session-recap-stat-value">{formatDistance(totalDistanceMeters)}</span>
              <span className="session-recap-stat-label">total distance</span>
            </div>
          )}
          {eventDurationMs != null && (
            <div className="session-recap-stat">
              <span className="session-recap-stat-value">{formatDuration(eventDurationMs)}</span>
              <span className="session-recap-stat-label">trip duration</span>
            </div>
          )}
          {firstToArrive && (
            <div className="session-recap-stat">
              <span className="session-recap-stat-value">{firstToArrive[1].name}</span>
              <span className="session-recap-stat-label">
                first to arrive{firstArrivalTripMs ? ` · ${formatDuration(firstArrivalTripMs)}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        {arrivedList.length === 0 ? (
          <p className="session-recap-empty">No one made it to the destination this time.</p>
        ) : (
          <div className="session-recap-body">

            {/* Podium — only when 2+ participants arrived */}
            {showPodium && firstToArrive && (
              <div className="session-recap-podium">
                <div className="session-recap-entry">
                  <MatIcon name="emoji_events" size={24} fill style={{ color: '#FBBC04' }} className="session-recap-medal" />
                  <div className="session-recap-entry-info">
                    <span className="session-recap-entry-label">First to arrive</span>
                    <span
                      className="session-recap-entry-name"
                      style={{ color: colorMap[firstToArrive[0]] }}
                    >
                      {firstToArrive[1].name}
                    </span>
                  </div>
                  <span className="session-recap-entry-aside">
                    {formatTime(firstToArrive[1].lastUpdated)}
                  </span>
                </div>

                {lastToArrive && (
                  <div className="session-recap-entry">
                    <MatIcon name="last_page" size={24} className="session-recap-medal" style={{ color: 'var(--text-2)' }} />
                    <div className="session-recap-entry-info">
                      <span className="session-recap-entry-label">Last to arrive</span>
                      <span
                        className="session-recap-entry-name"
                        style={{ color: colorMap[lastToArrive[0]] }}
                      >
                        {lastToArrive[1].name}
                      </span>
                    </div>
                    <span className="session-recap-entry-aside">
                      {formatTime(lastToArrive[1].lastUpdated)}
                    </span>
                  </div>
                )}

                {mostDelayed && (
                  <div className="session-recap-entry">
                    <MatIcon name="pace" size={24} className="session-recap-medal" />
                    <div className="session-recap-entry-info">
                      <span className="session-recap-entry-label">Most delayed</span>
                      <span
                        className="session-recap-entry-name"
                        style={{ color: colorMap[mostDelayed[0]] }}
                      >
                        {mostDelayed[1].name}
                      </span>
                    </div>
                    <span className="session-recap-entry-aside">
                      +{Math.round((mostDelayed[1].manualDelayMs ?? 0) / 60_000)} min
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Trip times table */}
            <div className="session-recap-trips">
              <h3 className="session-recap-trips-heading">
                <span aria-hidden="true">📊</span> Trip times
              </h3>
              {arrivedList.map(([id, p], i) => {
                const tripMs = p.tripStartedAt && p.lastUpdated
                  ? p.lastUpdated - p.tripStartedAt
                  : null;
                return (
                  <div key={id} className="session-recap-trip-row">
                    <span
                      className="session-recap-trip-avatar"
                      style={{ background: colorMap[id] }}
                      aria-hidden="true"
                    >
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="session-recap-trip-name">
                      {p.name}
                      {showPodium && i === 0 && (
                        <MatIcon name="emoji_events" size={16} fill style={{ color: '#FBBC04' }} className="session-recap-trip-gold" />
                      )}
                    </span>
                    <span className="session-recap-trip-duration">
                      {tripMs != null ? formatDuration(tripMs) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* ── Spectators table ── */}
        {spectatorList.length > 0 && (
          <div className="session-recap-trips">
            <h3 className="session-recap-trips-heading">
              <span aria-hidden="true">👀</span> Spectators
            </h3>
            {spectatorList.map(([id, p]) => (
              <div key={id} className="session-recap-trip-row">
                <span
                  className="session-recap-trip-avatar"
                  style={{ background: colorMap[id] }}
                  aria-hidden="true"
                >
                  {p.name?.[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="session-recap-trip-name">{p.name}</span>
                <span className="session-recap-trip-duration" style={{ opacity: 0.6 }}>
                  Watched the meetup 👀
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Event Details — collapsible, Social Edition only ── */}
        {hasLogistics && (
          <div className="session-recap-section glass-card">
            <button
              className="session-recap-details-toggle"
              onClick={() => setDetailsOpen(v => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide details ▲' : 'Show event details ▼'}
            </button>
            {detailsOpen && (
              <div className="session-recap-logistics">
                {logistics.dressCode && (
                  <div className="session-recap-logistics-row">
                    <span aria-hidden="true">👔</span>
                    <span>{logistics.dressCode}</span>
                  </div>
                )}
                {logistics.food && (
                  <div className="session-recap-logistics-row">
                    <span aria-hidden="true">🍽️</span>
                    <span>{logistics.food}</span>
                  </div>
                )}
                {logistics.parking && (
                  <div className="session-recap-logistics-row">
                    <span aria-hidden="true">🅿️</span>
                    <span>{logistics.parking}</span>
                  </div>
                )}
                {logistics.registry && (
                  <div className="session-recap-logistics-row">
                    <span aria-hidden="true">🔗</span>
                    <a
                      href={logistics.registry}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="session-recap-registry-link"
                    >
                      {logistics.registry}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Poll results — Social Edition only ── */}
        {hasPoll && (
          <div className="session-recap-section glass-card">
            <h3 className="session-recap-trips-heading" style={{ marginBottom: 10 }}>
              <span aria-hidden="true">🗳️</span> {poll.question}
            </h3>
            <div className="poll-options">
              {pollOptions.map(([optionId, option]) => {
                const voteCount = option.votes || 0;
                const pct = totalPollVotes > 0 ? Math.round((voteCount / totalPollVotes) * 100) : 0;
                return (
                  <div
                    key={optionId}
                    className="poll-option poll-option-voted"
                    role="img"
                    aria-label={`${option.text}: ${pct}% (${voteCount} vote${voteCount !== 1 ? 's' : ''})`}
                  >
                    <span
                      className="poll-option-bar"
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                    <span className="poll-option-text">{option.text}</span>
                    <span className="poll-option-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
            {totalPollVotes > 0 && (
              <p className="poll-vote-count">
                {totalPollVotes} vote{totalPollVotes !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* ── Guest summary — Social Edition only ── */}
        {guestSummary && (
          <div className="session-recap-section glass-card">
            <h3 className="session-recap-trips-heading" style={{ marginBottom: 10 }}>
              <span aria-hidden="true">👥</span> Guest summary
            </h3>
            {guestSummary.arrived.length > 0 && (
              <div className="session-recap-guest-group">
                <span className="session-recap-guest-status">✅ Arrived</span>
                <span className="session-recap-guest-names">{guestSummary.arrived.join(', ')}</span>
              </div>
            )}
            {guestSummary.enRoute.length > 0 && (
              <div className="session-recap-guest-group">
                <span className="session-recap-guest-status">🚗 En route (didn't make it)</span>
                <span className="session-recap-guest-names">{guestSummary.enRoute.join(', ')}</span>
              </div>
            )}
            {guestSummary.maybe.length > 0 && (
              <div className="session-recap-guest-group">
                <span className="session-recap-guest-status">❓ Maybe</span>
                <span className="session-recap-guest-names">{guestSummary.maybe.join(', ')}</span>
              </div>
            )}
            {guestSummary.cantGo.length > 0 && (
              <div className="session-recap-guest-group">
                <span className="session-recap-guest-status">✖️ Can't go</span>
                <span className="session-recap-guest-names">{guestSummary.cantGo.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Highlight Memory ── */}
        <div className="session-recap-memory">
          <h3 className="session-recap-trips-heading">
            <span aria-hidden="true">✨</span> Memories
          </h3>

          {/* Input area — only for the current user, only if not yet saved */}
          {myParticipantId && onSaveMemory && !myMemory && (
            <div className="session-recap-memory-input-row">
              <textarea
                className="session-recap-memory-textarea"
                placeholder="Add a memory or photo URL…"
                maxLength={200}
                rows={2}
                value={memoryDraft}
                onChange={(e) => setMemoryDraft(e.target.value)}
                aria-label="Your highlight memory"
              />
              <button
                className="btn btn-primary session-recap-memory-save"
                onClick={handleSaveMemory}
                disabled={!memoryDraft.trim() || memorySaving}
                aria-label="Save memory"
              >
                {memorySaving ? '…' : 'Save'}
              </button>
            </div>
          )}

          {/* My saved memory (if already saved) */}
          {myMemory && (
            <div className="session-recap-memory-mine">
              <span className="session-recap-memory-mine-label">Your memory saved ✓</span>
            </div>
          )}

          {/* All submitted memories */}
          {memories.length > 0 ? (
            <div className="session-recap-memory-list">
              {memories.map(({ id, name, memory, color }) => (
                <div key={id} className="session-recap-memory-item">
                  <span
                    className="session-recap-trip-avatar"
                    style={{ background: color, flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    {name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <div className="session-recap-memory-item-body">
                    <span className="session-recap-memory-item-name">{name}</span>
                    {isURL(memory) ? (
                      <a
                        href={memory}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="session-recap-memory-item-link"
                      >
                        {memory}
                      </a>
                    ) : (
                      <span className="session-recap-memory-item-text">{memory}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !myParticipantId && (
              <p className="session-recap-empty" style={{ marginTop: 8 }}>
                No memories shared yet.
              </p>
            )
          )}
        </div>

        {/* ── Clone / Done buttons ── */}
        {isHost && onClone && (
          <button
            className="btn btn-secondary btn-full"
            onClick={onClone}
            style={{ marginBottom: 8 }}
          >
            Clone This Meetup
          </button>
        )}
        <button className="btn btn-primary btn-full" onClick={onDone}>
          Done
        </button>

      </div>
    </div>
  );
}
