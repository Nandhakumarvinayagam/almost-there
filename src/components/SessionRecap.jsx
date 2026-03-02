/**
 * SessionRecap — full-screen overlay shown to all participants when the host
 * ends the meetup (session.status === 'completed').
 *
 * Shows:
 *   - 🥇 First to arrive (if 2+ arrived)
 *   - 🐢 Most delayed (if any manual bumps were used)
 *   - 📊 Trip times for every participant who arrived
 *   - A "Done" button that navigates home
 *
 * The recap reads directly from the live session state in Firebase (still
 * present since endSession() sets status:'completed', not deletes the node),
 * so every client sees the same data.
 */
import { useMemo } from 'react';
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

export default function SessionRecap({ session, participants, destination, onDone }) {
  // Stable color map keyed by participant ID (same logic as ETAPanel)
  const colorMap = useMemo(() => {
    const map = {};
    participants.forEach(([id, p], i) => { map[id] = getParticipantColor(p, i); });
    return map;
  }, [participants]);

  // Active travelers only — spectators have no trip data and must be excluded
  // from all arrival/duration/podium calculations.
  const travelers = useMemo(() =>
    participants.filter(([, p]) => p.status !== STATUS.SPECTATING),
    [participants]
  );

  // Spectators get their own list for the recap table
  const spectatorList = useMemo(() =>
    participants.filter(([, p]) => p.status === STATUS.SPECTATING),
    [participants]
  );

  // Arrived participants (active travelers only) sorted earliest → latest
  const arrivedList = useMemo(() =>
    travelers
      .filter(([, p]) => p.status === STATUS.ARRIVED && p.tripStartedAt)
      .sort(([, a], [, b]) => (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0)),
    [travelers]
  );

  // Participant with the most manual ETA bumps (🐢) — active travelers only
  const mostDelayed = useMemo(() => {
    const withDelay = travelers
      .filter(([, p]) => (p.manualDelayMs ?? 0) > 0)
      .sort(([, a], [, b]) => (b.manualDelayMs ?? 0) - (a.manualDelayMs ?? 0));
    return withDelay[0] ?? null;
  }, [travelers]);

  const destName = session?.nickname || destination?.name || destination?.address || 'Meetup';
  const showPodium = arrivedList.length >= 2;
  const firstToArrive = arrivedList[0] ?? null;

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
          <span className="session-recap-icon" aria-hidden="true"><MatIcon name="flag" size={40} fill /></span>
          <h2 className="session-recap-title">Meetup ended</h2>
          <p className="session-recap-subtitle">{destName}</p>
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

        {/* ── Done button ── */}
        <button className="btn btn-primary btn-full" onClick={onDone}>
          Done
        </button>

      </div>
    </div>
  );
}
