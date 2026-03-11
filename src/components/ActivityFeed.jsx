import { useEffect, useMemo, useRef, useState } from 'react';
import { ref, onChildAdded, onChildChanged } from 'firebase/database';
import { db } from '../utils/firebase';
import MatIcon from './MatIcon';

/**
 * ActivityFeed — real-time social activity feed for a session.
 *
 * Listens to sessions/{id}/activityFeed via BOTH child_added AND child_changed:
 *   - child_added:   fires for each existing entry on first attach, then new entries.
 *   - child_changed: fires when a fixed-key entry (e.g. state_scheduled_to_active)
 *                    is overwritten by another client. Without this, clients already
 *                    in the lobby miss state transition messages.
 *
 * Upsert pattern: entries are stored in a Map keyed by snapshot.key — NOT an
 * array. Both events call map.set(key, value), so fixed-key overwrites never
 * produce duplicates. The Map is converted to a sorted array only at render time.
 *
 * Debounce: both listeners share a 500ms debounce window. All snapshots that
 * arrive within the window are batched into a single setState call, preventing
 * rapid UI "jumps" when many people RSVP at the same time.
 *
 * Cap: internal state is trimmed to MAX_ENTRIES (100) newest entries. The
 * `maxDisplay` prop further limits what is rendered.
 *
 * Reference: Plan v5, Sections 9 (debounce), 10 (trigger catalog), A.6 (ghost
 * transition note on child_changed + Map requirement)
 *
 * @param {string}   props.sessionId      - Session ID to subscribe to
 * @param {'lobby'|'panel'} [props.variant='lobby']
 *   'lobby' → uses .lobby-feed / .lobby-feed-entry classes (Lobby.jsx)
 *   'panel' → uses .activity-feed / .activity-event classes (ETAPanel.jsx)
 * @param {number}   [props.maxDisplay=20]    - Max entries to render (newest first)
 * @param {string}   [props.emptyText]        - Text to show when feed is empty.
 *   If omitted the component renders null when there are no entries.
 * @param {function} [props.onCountChange]    - Called with the current display
 *   count whenever entries change. Used by ETAPanel to drive the unread badge.
 *   Stored in a ref internally so a non-memoized function doesn't cause re-runs.
 */

const MAX_ENTRIES = 100;
const DEBOUNCE_MS = 500;

/** Maps activity type → Material Symbol icon name. */
const TYPE_ICON = {
  rsvp:          'check_circle',
  rsvp_change:   'swap_horiz',
  logistics:     'edit_note',
  poll:          'how_to_vote',
  nudge:         'campaign',
  state:         'radio_button_checked',
  arrival_near:  'near_me',
  arrival:       'where_to_vote',
  kick:          'person_remove',
  // Legacy tracking-event types — included so the component renders gracefully
  // if entries from the old sessions/{id}/events path appear here.
  joined:        'person_add',
  trip_started:  'directions_car',
  arrived:       'flag',
  almost_there:  'near_me',
  paused:        'pause_circle',
  resumed:       'play_circle',
  left:          'logout',
  spectating:    'visibility',
};

function iconFor(type) {
  return TYPE_ICON[type] ?? 'info';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ActivityFeed({
  sessionId,
  variant = 'lobby',
  maxDisplay = 20,
  emptyText = null,
  onCountChange = null,
}) {
  // Internal state: Map<snapshotKey, entryObject>.
  // Keyed by Firebase snapshot key so that child_changed overwrites (e.g.
  // state_scheduled_to_active written by multiple simultaneous clients) produce
  // an upsert, never a duplicate.
  const [entryMap, setEntryMap] = useState(() => new Map());

  // Pending entries collected during the debounce window.
  const pendingRef = useRef(new Map());
  const timerRef   = useRef(null);

  useEffect(() => {
    if (!sessionId) return;

    const feedRef = ref(db, `sessions/${sessionId}/activityFeed`);

    // Flush all pending entries into React state in a single update.
    function flush() {
      timerRef.current = null;
      // Capture and clear pending before entering setState to avoid losing
      // entries that arrive while the setState callback is executing.
      const captured = new Map(pendingRef.current);
      pendingRef.current = new Map();

      setEntryMap((prev) => {
        const next = new Map(prev);
        captured.forEach((val, key) => next.set(key, val));

        // Trim to MAX_ENTRIES — keep the newest by timestamp.
        if (next.size > MAX_ENTRIES) {
          const sorted = [...next.entries()].sort(
            (a, b) => (a[1].timestamp ?? 0) - (b[1].timestamp ?? 0),
          );
          return new Map(sorted.slice(-MAX_ENTRIES));
        }
        return next;
      });
    }

    // Shared handler for both child_added and child_changed.
    // Stores snapshot into pending and (re)schedules the debounce flush.
    function handleSnapshot(snapshot) {
      const key = snapshot.key;
      const val = { ...snapshot.val(), _fbKey: key };
      pendingRef.current.set(key, val);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, DEBOUNCE_MS);
      }
    }

    const unsubAdded   = onChildAdded(feedRef, handleSnapshot);
    const unsubChanged = onChildChanged(feedRef, handleSnapshot);

    return () => {
      unsubAdded();
      unsubChanged();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Discard any un-flushed pending entries on unmount.
      pendingRef.current = new Map();
    };
  }, [sessionId]);

  // Convert Map to array sorted by timestamp ascending, then slice from the
  // newest end to honour maxDisplay, then reverse for newest-first rendering.
  const display = useMemo(
    () =>
      [...entryMap.values()]
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
        .slice(-maxDisplay)
        .reverse(),
    [entryMap, maxDisplay],
  );

  // Notify parent of count changes so ETAPanel can drive its unread badge.
  // onCountChange is stored in a ref to avoid rerunning the effect when the
  // caller passes a non-memoized function.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => { onCountChangeRef.current = onCountChange; }, [onCountChange]);
  useEffect(() => {
    onCountChangeRef.current?.(display.length);
  }, [display.length]);

  if (display.length === 0) {
    if (!emptyText) return null;
    return <div className="eta-activity-empty">{emptyText}</div>;
  }

  // ── Lobby variant ─────────────────────────────────────────────────────────
  if (variant === 'lobby') {
    return (
      <div className="lobby-section lobby-feed">
        <div className="lobby-section-title">Activity</div>
        {display.map((entry) => (
          <div key={entry._fbKey} className="lobby-feed-entry">
            <span className="lobby-feed-text">
              <MatIcon
                name={iconFor(entry.type)}
                size={14}
                style={{ verticalAlign: 'middle', marginRight: '4px' }}
              />
              {entry.text}
            </span>
            {entry.timestamp && (
              <span className="lobby-feed-time">{formatTime(entry.timestamp)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ── Panel variant (ETAPanel Activity tab) ─────────────────────────────────
  return (
    <div className="activity-feed" aria-label="Session activity">
      {display.map((entry) => (
        <div key={entry._fbKey} className="activity-event">
          <span className="activity-event-text">
            <MatIcon
              name={iconFor(entry.type)}
              size={12}
              style={{ verticalAlign: 'middle', marginRight: '4px' }}
            />
            {entry.text}
          </span>
          {entry.timestamp && (
            <span className="activity-event-time">{formatTime(entry.timestamp)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
