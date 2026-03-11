import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, clearHistory } from '../utils/sessionHistory';
import { SESSION_TTL } from '../config/constants';

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(() => getHistory());

  function handleJoin(e) {
    e.preventDefault();
    setError('');

    const raw = code.trim();
    if (!raw) return;

    // Accept either a full URL (.../session/ABC123) or a bare 6-char code
    const match = raw.match(/([A-Z0-9]{6})$/i);
    if (!match) {
      setError('Enter a valid 6-character session code.');
      return;
    }
    navigate(`/session/${match[1].toUpperCase()}`);
  }

  function handleClearHistory() {
    clearHistory();
    setHistory([]);
  }

  // Navigate to Create with the destination pre-filled.
  // Never carry over scheduledTime — the datetime picker must start empty.
  function handleStartAgain(destination) {
    navigate('/create', { state: { prefillDestination: destination } });
  }

  // Navigate to Create with all cloneable fields pre-filled (hosted sessions only).
  function handleClone(entry) {
    navigate('/create', { state: { cloneFrom: {
      destination:  entry.destination,
      nickname:     entry.nickname     ?? null,
      theme:        entry.theme        ?? null,
      logistics:    entry.logistics    ?? null,
    }}});
  }

  function handleOpen(sessionId) {
    navigate(`/session/${sessionId}`);
  }

  return (
    <div className="home">
      <div className="home-hero">
        <h1>Almost There</h1>
        <p>Share your live location with friends&nbsp;meeting&nbsp;up</p>
      </div>

      <div className="home-actions">
        <button
          className="btn btn-primary btn-full"
          onClick={() => navigate('/create')}
        >
          Create Meetup
        </button>

        <div className="divider">or</div>

        <form className="join-form" onSubmit={handleJoin}>
          <input
            className="input"
            type="text"
            placeholder="Enter 6-character code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(''); }}
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={80}
            aria-label="Session code"
          />
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn btn-secondary btn-full">
            Join Meetup
          </button>
        </form>
      </div>

      {/* Recent Meetups — only shown when history exists */}
      {history.length > 0 && (
        <section className="history-section" aria-label="Recent meetups">
          <div className="history-header">
            <h2 className="history-title">Recent Meetups</h2>
            <button
              className="btn-link"
              onClick={handleClearHistory}
              aria-label="Clear meetup history"
            >
              Clear
            </button>
          </div>

          <ul className="history-list">
            {history.slice(0, 5).map((entry) => {
              const state = getEntryState(entry);
              return (
                <li key={entry.sessionId} className="history-item">
                  <div className="history-dest">
                    <span className="history-dest-name">
                      {entry.nickname || entry.destination?.name || entry.destination?.address || 'Meetup'}
                    </span>
                    {entry.nickname && (entry.destination?.name || entry.destination?.address) && (
                      <span className="history-dest-sub">
                        {entry.destination.name || entry.destination.address}
                      </span>
                    )}
                    <span className="history-meta">
                      {state === 'scheduled-future'
                        ? `Scheduled · ${formatScheduledTime(entry.scheduledTime)}`
                        : state === 'active'
                          ? 'In progress'
                          : (
                              <>
                                {formatDate(entry.date)}
                                {entry.participants?.length > 0 && ` · ${entry.participants.length} people`}
                                {entry.wasHost && ' · You hosted'}
                              </>
                            )
                      }
                    </span>
                  </div>
                  {state === 'expired' ? (
                    entry.wasHost ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleClone(entry)}
                        aria-label={`Clone meetup at ${entry.destination?.name || 'this destination'}`}
                      >
                        Clone
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleStartAgain(entry.destination)}
                        aria-label={`Start again at ${entry.destination?.name || 'this destination'}`}
                      >
                        Start again
                      </button>
                    )
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpen(entry.sessionId)}
                      aria-label={`Open meetup at ${entry.destination?.name || 'this destination'}`}
                    >
                      Open
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Determine the display state for a history entry.
 *
 * - 'scheduled-future' — has a future scheduledTime and session hasn't expired
 * - 'active'           — session still live (scheduled & started, or regular)
 * - 'expired'          — session has expired
 */
function getEntryState(entry) {
  const now = Date.now();
  // Fall back to deriving expiresAt from creation date for old history entries
  // that predate the expiresAt field (SESSION_TTL = 2 hours).
  const expiresAt = entry.expiresAt ?? (entry.date + SESSION_TTL);
  if (expiresAt <= now) return 'expired';
  if (entry.scheduledTime && entry.scheduledTime > now) return 'scheduled-future';
  return 'active';
}

/** Format a future scheduled timestamp as "Today at 3:00 PM", "Tomorrow at …", or "Mon, Mar 3 at …". */
function formatScheduledTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  let dayStr;
  if (d.toDateString() === today.toDateString()) {
    dayStr = 'Today';
  } else if (d.toDateString() === tomorrow.toDateString()) {
    dayStr = 'Tomorrow';
  } else {
    dayStr = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${dayStr} at ${timeStr}`;
}

/** Format a timestamp as "Today", "Yesterday", or "Jan 5". */
function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
