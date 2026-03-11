/**
 * EventDetails — read-only event information panel for the active session view.
 *
 * Rendered inside the "Details" tab of ETAPanel. Consumes already-loaded
 * session data; does NOT add any Firebase listeners or API calls.
 *
 * Sections (each skipped when data is absent):
 *   1. Hero      — theme emoji + session nickname
 *   2. Group note — session.notes with copy-to-clipboard
 *   3. Logistics  — dressCode / food / parking / registry cards
 *   4. Poll       — read-only results with percentage bars
 *   5. Headcount  — going / maybe / can't-go summary with plus-ones
 *
 * Props:
 *   session     {object}  normalizeSession() output
 *   participants {Array}  [[id, normalizeParticipant(p)], …]  (same shape as ETAPanel)
 *   isHost      {boolean}
 */
import { useState } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import { detectRegistryLabel } from '../utils/registryLabel';
import MatIcon from './MatIcon';

// Icon mapping for logistics fields
const LOGISTICS_CONFIG = [
  { key: 'dressCode', icon: 'checkroom',      label: 'Dress Code' },
  { key: 'food',      icon: 'restaurant',     label: 'Food'       },
  { key: 'parking',  icon: 'local_parking',   label: 'Parking'   },
  { key: 'registry', icon: 'link',            label: 'Registry'   },
];

export default function EventDetails({ session, participants = [], isHost = false }) {
  const [copied, setCopied] = useState(false);

  if (!session) return null;

  const {
    theme        = {},
    logistics    = null,
    poll         = null,
    notes,
    nickname,
  } = session;

  const emoji = theme?.emoji || '📍';

  // ── Section visibility flags ─────────────────────────────────────────────
  const hasNickname    = !!nickname?.trim();
  const hasNotes       = !!notes?.trim();
  const hasLogistics   = !!(logistics && LOGISTICS_CONFIG.some(({ key }) => {
    const v = logistics[key];
    return v != null && v !== '';
  }));
  const hasPoll        = !!(poll?.question && poll?.options && Object.keys(poll.options).length > 0);
  // ── Headcount computation ─────────────────────────────────────────────────
  let goingCount = 0, maybeCount = 0, cantGoCount = 0, plusOnesSum = 0;
  for (const [, p] of participants) {
    const status = p.rsvpStatus ?? 'going';
    if (status === 'going') {
      goingCount++;
      plusOnesSum += p.plusOnes || 0;
    } else if (status === 'maybe') {
      maybeCount++;
    } else if (status === 'cant-go') {
      cantGoCount++;
    }
  }
  const hasHeadcount = participants.length > 0;

  const hasAnySocialData = hasNotes || hasLogistics || hasPoll || hasHeadcount;
  const showEmpty = !emoji && !hasNickname && !hasAnySocialData;

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleCopyNotes() {
    try {
      await copyToClipboard(notes);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (showEmpty) {
    return (
      <div className="event-details-empty">
        <MatIcon name="event_note" size={32} />
        <p>No event details</p>
      </div>
    );
  }

  return (
    <div className="event-details">

      {/* ── 1. Hero ── */}
      <div className="event-details-hero">
        <span className="event-details-emoji" aria-hidden="true">{emoji}</span>
        {hasNickname && <p className="event-details-nickname">{nickname}</p>}
      </div>

      {/* ── 2. Group note ── */}
      {hasNotes && (
        <div className="event-details-section">
          <div className="event-details-section-header">
            <MatIcon name="notes" size={15} />
            <span>Group Note</span>
          </div>
          <div className="event-details-notes-row">
            <p className="event-details-notes-text">{notes}</p>
            <button
              className="event-details-copy-btn"
              onClick={handleCopyNotes}
              aria-label={copied ? 'Copied!' : 'Copy note to clipboard'}
              title={copied ? 'Copied!' : 'Copy note'}
            >
              <MatIcon name={copied ? 'check' : 'content_copy'} size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── 3. Logistics ── */}
      {hasLogistics && (
        <div className="event-details-section">
          <div className="event-details-section-header">
            <MatIcon name="info" size={15} />
            <span>Details</span>
          </div>
          {LOGISTICS_CONFIG.map(({ key, icon, label }) => {
            const value = logistics[key];
            if (value == null || value === '') return null;

            if (key === 'registry') {
              const regInfo = detectRegistryLabel(value);
              return (
                <div key={key} className="event-details-logistics-card">
                  <MatIcon name={regInfo?.icon ?? 'link'} size={18} />
                  <div className="event-details-logistics-content">
                    <span className="event-details-logistics-label">{label}</span>
                    <a
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="event-details-registry-link"
                    >
                      {regInfo?.label ?? 'Link'}
                      <MatIcon name="open_in_new" size={12} />
                    </a>
                  </div>
                </div>
              );
            }

            return (
              <div key={key} className="event-details-logistics-card">
                <MatIcon name={icon} size={18} />
                <div className="event-details-logistics-content">
                  <span className="event-details-logistics-label">{label}</span>
                  <span className="event-details-logistics-value">{value}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 4. Poll results ── */}
      {hasPoll && (
        <div className="event-details-section">
          <div className="event-details-section-header">
            <MatIcon name="poll" size={15} />
            <span>Poll Results</span>
          </div>
          <p className="event-details-poll-question">{poll.question}</p>
          <PollResults poll={poll} />
        </div>
      )}

      {/* ── 5. Headcount ── */}
      {hasHeadcount && (
        <div className="event-details-section">
          <div className="event-details-section-header">
            <MatIcon name="group" size={15} />
            <span>Headcount</span>
          </div>
          <p className="event-details-headcount">
            <strong>{goingCount}</strong> going
            {plusOnesSum > 0 && (
              <span className="event-details-plusones">
                {' '}(+{plusOnesSum} plus-{plusOnesSum === 1 ? 'one' : 'ones'})
              </span>
            )}
            {maybeCount > 0 && (
              <> · <strong>{maybeCount}</strong> maybe</>
            )}
            {cantGoCount > 0 && (
              <> · <strong>{cantGoCount}</strong> can&apos;t go</>
            )}
          </p>
        </div>
      )}

    </div>
  );
}

// ── Poll results sub-component ────────────────────────────────────────────────
// Reuses .poll-option / .poll-option-bar / .poll-option-pct CSS from index.css.
// All options shown as voted (read-only); no clickable state.
function PollResults({ poll }) {
  const options = Object.entries(poll.options);
  const totalVotes = options.reduce((sum, [, o]) => sum + (o.votes || 0), 0);

  return (
    <>
      <div className="poll-options">
        {options.map(([optionId, option]) => {
          const voteCount = option.votes || 0;
          const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
          return (
            <div key={optionId} className="poll-option poll-option-voted">
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
      {totalVotes > 0 && (
        <p className="poll-vote-count">
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
        </p>
      )}
    </>
  );
}
