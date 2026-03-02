import { useState } from 'react';

export default function JoinPrompt({
  title = "What's your name?",
  subtitle,
  onSubmit,
  onCancel,
  loading = false,
}) {
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="prompt-card">
        <h3>{title}</h3>
        {subtitle && <p className="prompt-subtitle">{subtitle}</p>}

        <form onSubmit={handleSubmit} autoComplete="off">
          <input
            className="input"
            type="text"
            id="dn_input_field"
            name="display_name_meetup"
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
          />

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
              disabled={!name.trim() || loading}
            >
              {loading ? 'Creating…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
