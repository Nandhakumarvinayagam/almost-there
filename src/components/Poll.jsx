import { useState } from 'react';
import MatIcon from './MatIcon';

/**
 * Poll — renders a session poll with vote counting.
 *
 * Votes are final in V1 (plan v5, Section 9). Once a participant votes,
 * all options are disabled, the selected option shows a checkmark, and a
 * percentage bar fills each option proportional to its vote share.
 *
 * Double-vote prevention: the Firebase security rule rejects a write to
 * `participants/{id}/pollVote` if the field already exists. The UI enforces
 * this too by disabling all options once myVote is truthy.
 *
 * @param {object}      props.poll      - session.poll { question, options: { [id]: { text, votes } } }
 * @param {string|null} props.myVote    - participant.pollVote (optionId) or null if not voted
 * @param {boolean}     props.hasJoined - User must be joined to vote (spectators see results only)
 * @param {function}    props.onVote    - (optionId) => Promise — writes pollVote + increments votes + feed
 */
export default function Poll({ poll, myVote, hasJoined, onVote }) {
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState(false);

  if (!poll?.question || !poll?.options) return null;

  const options = Object.entries(poll.options); // [[optionId, { text, votes }], ...]
  const totalVotes = options.reduce((sum, [, o]) => sum + (o.votes || 0), 0);
  const hasVoted = !!myVote;

  const handleVote = async (optionId) => {
    if (hasVoted || !hasJoined || voting) return;
    setVoting(true);
    setVoteError(false);
    try {
      await onVote(optionId);
    } catch (err) {
      console.error('Poll vote failed:', err);
      setVoteError(true);
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="lobby-card lobby-poll">
      <div className="lobby-card-header">
        <MatIcon name="poll" size={18} />
        <span className="lobby-card-label">Poll</span>
      </div>

      <p className="poll-question">{poll.question}</p>

      {!hasVoted && hasJoined && (
        <p className="poll-disclaimer">Votes are final for this meetup!</p>
      )}
      {!hasJoined && (
        <p className="poll-disclaimer">RSVP to vote</p>
      )}

      <div className="poll-options" role="group" aria-label="Poll options">
        {options.map(([optionId, option]) => {
          const isSelected = myVote === optionId;
          const voteCount = option.votes || 0;
          const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

          return (
            <button
              key={optionId}
              className={[
                'poll-option',
                isSelected ? 'poll-option-selected' : '',
                hasVoted ? 'poll-option-voted' : '',
              ].join(' ').trim()}
              onClick={() => handleVote(optionId)}
              disabled={hasVoted || !hasJoined || voting}
              aria-pressed={isSelected}
            >
              {/* Background fill bar (shown after voting) */}
              {hasVoted && (
                <span
                  className="poll-option-bar"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
              )}

              <span className="poll-option-text">{option.text}</span>

              {hasVoted && (
                <span className="poll-option-pct">{pct}%</span>
              )}

              {isSelected && (
                <MatIcon name="check_circle" size={16} />
              )}
            </button>
          );
        })}
      </div>

      {hasVoted && totalVotes > 0 && (
        <p className="poll-vote-count">
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
        </p>
      )}

      {voteError && (
        <p style={{ fontSize: '12px', color: '#dc2626', marginTop: 6 }}>
          Vote failed. Tap an option to try again.
        </p>
      )}
    </div>
  );
}
