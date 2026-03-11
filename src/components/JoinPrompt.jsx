import { useState } from 'react';
import MatIcon from './MatIcon';
import { getContrastTextColor } from '../utils/theme';
import { AvatarPicker } from './Avatars';

const RSVP_OPTIONS = [
  { value: 'going',    label: 'Going',    icon: 'check_circle' },
  { value: 'maybe',   label: 'Maybe',    icon: 'help'         },
  { value: 'cant-go', label: "Can't Go", icon: 'cancel'       },
];

/**
 * Join prompt for active sessions.
 * Collects name + RSVP status + plus-ones + anonymous mode.
 *
 * onSubmit signature: (name: string, rsvpStatus: string, plusOnes: number, visibility: string, avatarId: number|null) => void
 */
export default function JoinPrompt({
  title = "What's your name?",
  subtitle,
  onSubmit,
  onCancel,
  loading = false,
  themeColor = '#0066CC',
}) {
  const [name, setName] = useState('');
  const [rsvpStatus, setRsvpStatus] = useState('going');
  const [plusOnes, setPlusOnes] = useState(0);
  const [anonymousMode, setAnonymousMode] = useState(false);
  const [avatarId, setAvatarId] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    const finalName = anonymousMode ? 'Anonymous' : name.trim();
    if (!finalName) return;
    onSubmit(finalName, rsvpStatus, plusOnes, anonymousMode ? 'hidden' : 'visible', avatarId);
  }

  function handleRsvpChange(value) {
    setRsvpStatus(value);
    if (value !== 'going') setPlusOnes(0);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="prompt-card">
        <h3>{title}</h3>
        {subtitle && <p className="prompt-subtitle">{subtitle}</p>}

        <form onSubmit={handleSubmit} autoComplete="off">
          {/* Name input row with inline anonymous toggle */}
          <div className="join-name-row">
            <input
              className={`input join-name-input${anonymousMode ? ' disabled' : ''}`}
              type="text"
              id="dn_input_field"
              name="display_name_meetup"
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              placeholder="Your name"
              value={anonymousMode ? 'Anonymous' : name}
              onChange={(e) => setName(e.target.value)}
              disabled={anonymousMode}
              autoFocus={!anonymousMode}
              maxLength={30}
              aria-label="Your name"
            />
            <button
              type="button"
              className={`join-anon-btn${anonymousMode ? ' active' : ''}`}
              onClick={() => setAnonymousMode((prev) => !prev)}
              title={anonymousMode ? 'Switch to named join' : 'Join anonymously'}
              aria-label={anonymousMode ? 'Switch to named join' : 'Join anonymously'}
            >
              <MatIcon
                name={anonymousMode ? 'visibility' : 'visibility_off'}
                size={22}
              />
            </button>
          </div>
          <p className="join-anon-hint">
            {anonymousMode ? 'Joining as anonymous guest' : ''}
          </p>

          {/* Avatar picker */}
          <AvatarPicker selected={avatarId} onSelect={setAvatarId} />

          {/* RSVP status selector */}
          <div className="lobby-rsvp-options" role="group" aria-label="RSVP status">
            {RSVP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`lobby-rsvp-option${rsvpStatus === opt.value ? ' lobby-rsvp-option-selected' : ''}`}
                onClick={() => handleRsvpChange(opt.value)}
                aria-pressed={rsvpStatus === opt.value}
              >
                <MatIcon name={opt.icon} size={18} />
                {opt.label}
              </button>
            ))}
          </div>

          {/* Plus-ones stepper — only shown when Going */}
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

          <div className="prompt-actions">
            {onCancel && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                disabled={loading}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={(!name.trim() && !anonymousMode) || loading}
              style={{
                background: 'var(--theme-primary)',
                color: getContrastTextColor(themeColor),
              }}
            >
              {loading ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
