import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLoadScript, Autocomplete } from '@react-google-maps/api';
import { SESSION_TTL, ARRIVAL_RADIUS_OPTIONS } from '../config/constants';
import { createSession } from '../hooks/useSession';
import { ensureAuth } from '../utils/firebase';
import { saveSession } from '../utils/sessionHistory';
import JoinPrompt from '../components/JoinPrompt';
import {
  saveFavorite, getFavorites, removeFavorite, isFavorite, findFavorite,
} from '../utils/favorites';
import MatIcon from '../components/MatIcon';

// Must be defined outside component to keep reference stable
const LIBRARIES = ['places'];


async function hashPin(pin) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Format a Date as the value for a datetime-local input ("YYYY-MM-DDTHH:MM"). */
function toLocalDatetimeString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Social Edition constants ──────────────────────────────────────

const THEME_EMOJIS = ['📍', '🎉', '🍕', '🎵', '🎮', '🌮', '⚽', '🎂', '🏖️', '🎪'];

const LOGISTICS_FIELDS = [
  { key: 'dressCode', label: 'Dress Code', icon: 'checkroom',     placeholder: 'e.g. Wear something yellow!' },
  { key: 'food',      label: 'Food',       icon: 'restaurant',    placeholder: 'e.g. Potluck style'          },
  { key: 'parking',   label: 'Parking',    icon: 'local_parking', placeholder: 'e.g. Street parking only'    },
  { key: 'registry',  label: 'Registry',   icon: 'card_giftcard', placeholder: 'https://venmo.com/...'       },
];

export default function Create() {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const navigate  = useNavigate();
  const location  = useLocation();

  // ---- Pre-fill from history "Start again" ----
  const prefill = location.state?.prefillDestination ?? null;
  // ---- Pre-fill from "Clone This Meetup" (carries theme, logistics) ----
  const clone = location.state?.cloneFrom ?? null;

  const initialDest = clone?.destination ?? prefill ?? null;
  const [destination, setDestination] = useState(initialDest);
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Two-step creation: name (JoinPrompt) → PIN modal → create
  const [pendingHostName, setPendingHostName] = useState('');
  const [pendingAvatarId, setPendingAvatarId] = useState(null);
  const [showPinModal,    setShowPinModal]    = useState(false);
  const [pin,             setPin]             = useState('');
  const [nickname,     setNickname]     = useState(clone?.nickname ?? '');
  const [notes,        setNotes]        = useState('');
  const [arrivalRadius, setArrivalRadius] = useState(250); // default 250 m

  // ---- Schedule for later ----
  const [scheduleOpen,  setScheduleOpen]  = useState(false);
  const [scheduledTime, setScheduledTime] = useState(''); // datetime-local input value

  // ---- Expected guest count ----
  const [expectedCount, setExpectedCount] = useState(null); // null = not set; 2-20 when set

  // ---- Favorites ----
  const [favorites,    setFavorites]    = useState(() => getFavorites());
  const [isCurrentFav, setIsCurrentFav] = useState(
    () => prefill ? isFavorite(prefill.lat, prefill.lng) : false
  );

  // ── Social Edition state ───────────────────────────────────────

  // Event details always open by default
  const [showEventDetails, setShowEventDetails] = useState(true);

  // Theme — only emoji is user-selectable; color and style are fixed
  const [themeEmoji, setThemeEmoji] = useState(clone?.theme?.emoji ?? '📍');

  // Logistics — track both enabled state and values; pre-open any cloned logistics fields
  const [logisticsOpen, setLogisticsOpen] = useState(() => {
    const l = clone?.logistics || {};
    return { dressCode: !!l.dressCode, food: !!l.food, parking: !!l.parking, registry: !!l.registry };
  });
  const [logisticsVals, setLogisticsVals] = useState(() => ({
    dressCode: clone?.logistics?.dressCode ?? '',
    food:      clone?.logistics?.food      ?? '',
    parking:   clone?.logistics?.parking   ?? '',
    registry:  clone?.logistics?.registry  ?? '',
  }));

  // Poll
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions,  setPollOptions]  = useState(['', '']);

  // Stops/waypoints (max 3)
  const [stops, setStops] = useState([]);
  const stopAutocompleteRefs = useRef([]);

  const autocompleteRef = useRef(null);
  const searchInputRef  = useRef(null);
  const notesRef        = useRef(null);

  // ---- Pre-fill search input text once the map (and input) have mounted ----
  useEffect(() => {
    const fillDest = clone?.destination ?? prefill;
    if (!isLoaded || !fillDest || !searchInputRef.current) return;
    searchInputRef.current.value = fillDest.name || fillDest.address || '';
  }, [isLoaded, clone, prefill]);

  // ---- Shared destination setter — updates star state too ----
  const handleSetDestination = useCallback((loc) => {
    setDestination(loc);
    setIsCurrentFav(isFavorite(loc.lat, loc.lng));
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (!autocompleteRef.current) return;
    const place = autocompleteRef.current.getPlace();
    if (!place.geometry?.location) return;

    const loc = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      name: place.name || place.formatted_address || 'Selected location',
      address: place.formatted_address || '',
    };
    handleSetDestination(loc);
  }, [handleSetDestination]);

  // ---- Favorite chip picked ----
  const handleFavoriteChip = useCallback((fav) => {
    handleSetDestination(fav);
    if (searchInputRef.current) {
      searchInputRef.current.value = fav.name || fav.address || '';
    }
  }, [handleSetDestination]);

  // ---- Star button — toggle favorite ----
  const handleToggleFavorite = useCallback(() => {
    if (!destination) return;
    if (isCurrentFav) {
      const fav = findFavorite(destination.lat, destination.lng);
      if (fav) removeFavorite(fav.id);
      setIsCurrentFav(false);
    } else {
      saveFavorite(destination);
      setIsCurrentFav(true);
    }
    setFavorites(getFavorites());
  }, [destination, isCurrentFav]);

  // ── Social Edition helpers ────────────────────────────────────

  const toggleLogistics = (key) => {
    setLogisticsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateLogisticsVal = (key, val) => {
    setLogisticsVals((prev) => ({ ...prev, [key]: val }));
  };

  const addPollOption = () => {
    if (pollOptions.length >= 6) return;
    setPollOptions((prev) => [...prev, '']);
  };

  const updatePollOption = (i, val) => {
    setPollOptions((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  };

  const removePollOption = (i) => {
    if (pollOptions.length <= 2) return;
    setPollOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  // Step 1: JoinPrompt submits name + avatar → store them, show PIN modal
  function handleNameSubmit(hostName, _rsvpStatus, _plusOnes, _visibility, avatarId) {
    setPendingHostName(hostName);
    setPendingAvatarId(avatarId ?? null);
    setShowJoinPrompt(false);
    setShowPinModal(true);
    setPin('');
  }

  // Step 2 (skip path)
  async function handleSkipPin() {
    await doCreateSession(null);
  }

  // Step 2 (PIN path)
  async function handlePinSubmit(e) {
    e.preventDefault();
    if (pin.length !== 4) return;
    setLoading(true);
    setError(null);
    try {
      const hash = await hashPin(pin);
      await doCreateSession(hash);
    } catch (err) {
      console.error('Failed to hash PIN:', err);
      setError('Failed to secure PIN. Please try again.');
      setLoading(false);
    }
  }

  // Final step: write session to Firebase
  async function doCreateSession(hostSecretHash) {
    if (!destination) return;
    setLoading(true);
    setError(null);

    // Use the stable anonymous auth UID so security rules (auth.uid === $participantId) work.
    let hostId;
    try {
      const user = await ensureAuth();
      hostId = user.uid;
    } catch (authErr) {
      console.error('Auth failed:', authErr);
      setError('Could not connect to server. Check your internet and try again.');
      setLoading(false);
      return;
    }

    try {
      const scheduledTimeMs = scheduledTime ? new Date(scheduledTime).getTime() : null;
      const now = Date.now();

      // Build logistics — only include non-empty values
      const cleanedLogistics = {};
      LOGISTICS_FIELDS.forEach(({ key }) => {
        const val = logisticsVals[key]?.trim();
        if (val && logisticsOpen[key]) cleanedLogistics[key] = val;
      });

      // Build poll — only if question + at least 2 non-empty options
      const validOptions = pollOptions.filter((o) => o.trim());
      let pollData = null;
      if (pollQuestion.trim() && validOptions.length >= 2) {
        const options = {};
        validOptions.forEach((text, i) => {
          options[`opt_${i}`] = { text: text.trim(), votes: 0 };
        });
        pollData = { question: pollQuestion.trim(), options };
      }

      const sessionId = await createSession({
        destination,
        hostId,
        hostSecretHash,
        hostName:       pendingHostName,
        nickname,
        notes,
        arrivalRadius,
        ...(expectedCount != null && { expectedCount }),
        ...(scheduledTimeMs && { scheduledTime: scheduledTimeMs }),
        theme: { color: '#0066CC', emoji: themeEmoji, style: 'classic' },
        logistics: cleanedLogistics,
        ...(pollData && { poll: pollData }),
        ...(stops.filter(s => s.lat != null).length > 0 && { stops: stops.filter(s => s.lat != null) }),
        ...(pendingAvatarId != null && { avatarId: pendingAvatarId }),
      });

      const expiresAt = scheduledTimeMs
        ? scheduledTimeMs + SESSION_TTL
        : now + SESSION_TTL;
      saveSession({
        sessionId,
        destination,
        nickname: nickname.trim() || null,
        date: now,
        participants: [pendingHostName],
        wasHost: true,
        ...(scheduledTimeMs && { scheduledTime: scheduledTimeMs }),
        expiresAt,
        // Store social fields so "Clone This Meetup" works from the home screen
        theme: { color: '#0066CC', emoji: themeEmoji, style: 'classic' },
        ...(Object.keys(cleanedLogistics).length > 0 && { logistics: cleanedLogistics }),
      });

      sessionStorage.setItem(`participant_${sessionId}`, hostId);
      sessionStorage.setItem(`name_${sessionId}`, pendingHostName);

      navigate(`/session/${sessionId}`);
    } catch (err) {
      console.error('Failed to create session:', err?.code, err?.message, err);
      const msg = err?.code === 'PERMISSION_DENIED'
        ? 'Permission denied — try refreshing the page.'
        : 'Failed to create meetup. Please try again.';
      setError(msg);
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="loading">
        Failed to load Google Maps. Check your API key.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="loading">
        <div className="loading-spinner" aria-hidden="true" />
        Loading map…
      </div>
    );
  }

  const minDatetime = toLocalDatetimeString(new Date());
  const activeLogisticsCount = LOGISTICS_FIELDS.filter(({ key }) => logisticsOpen[key]).length;

  return (
    <div className="create">
      {/* Search bar + favorite chips — float over the map */}
      <div className="create-header">
        {/* Nickname */}
        <div className="nickname-input-wrap">
          <input
            type="text"
            className="nickname-input"
            placeholder="Name this meetup (optional)"
            aria-label="Meetup nickname (optional)"
            maxLength={40}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={(e) => setNickname(e.target.value.trim())}
          />
          {nickname.length > 30 && (
            <span className="nickname-counter" aria-live="polite">
              {nickname.length} / 40
            </span>
          )}
        </div>

        <Autocomplete
          onLoad={(ac) => (autocompleteRef.current = ac)}
          onPlaceChanged={onPlaceChanged}
          fields={['geometry', 'name', 'formatted_address']}
        >
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search for a destination…"
            aria-label="Search for a destination"
          />
        </Autocomplete>

        {favorites.length > 0 && (
          <div className="fav-chips" aria-label="Favorite destinations">
            {favorites.map((fav) => {
              const active = destination
                && Math.abs(fav.lat - destination.lat) < 0.0001
                && Math.abs(fav.lng - destination.lng) < 0.0001;
              return (
                <button
                  key={fav.id}
                  className={`fav-chip${active ? ' fav-chip-active' : ''}`}
                  onClick={() => handleFavoriteChip(fav)}
                  aria-label={`Use favorite: ${fav.name || fav.address}`}
                  aria-pressed={!!active}
                >
                  <MatIcon name="star" size={14} fill style={{ color: '#FBBC04' }} /> {fav.name || fav.address}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="create-footer">
        {destination && (
          <div className="destination-preview">
            <div className="destination-preview-text">
              <span className="destination-preview-name">
                <MatIcon name="location_on" size={16} />
                {destination.name || 'Custom location'}
              </span>
              {destination.address && destination.address !== destination.name && (
                <span className="destination-preview-address">{destination.address}</span>
              )}
            </div>
            <button
              className={`star-btn${isCurrentFav ? ' star-btn-active' : ''}`}
              onClick={handleToggleFavorite}
              aria-label={isCurrentFav ? 'Remove from favorites' : 'Save as favorite'}
              title={isCurrentFav ? 'Remove from favorites' : 'Save as favorite'}
            >
              <MatIcon name="star" size={20} fill={isCurrentFav} style={isCurrentFav ? { color: '#FBBC04' } : undefined} />
            </button>
          </div>
        )}

        {/* Stops / Waypoints — rows only render once a destination is set */}
        {destination && stops.length > 0 && (
          <div className="stops-section">
            {stops.map((stop, i) => (
              <div key={i} className="stop-row">
                <span className="stop-number">{i + 1}</span>
                <Autocomplete
                  onLoad={(ac) => { stopAutocompleteRefs.current[i] = ac; }}
                  onPlaceChanged={() => {
                    const ac = stopAutocompleteRefs.current[i];
                    if (!ac) return;
                    const place = ac.getPlace();
                    if (!place.geometry?.location) return;
                    const updated = [...stops];
                    updated[i] = {
                      lat: place.geometry.location.lat(),
                      lng: place.geometry.location.lng(),
                      name: place.name || '',
                      address: place.formatted_address || '',
                    };
                    setStops(updated);
                  }}
                >
                  <input
                    type="text"
                    className="stop-input"
                    placeholder={`Stop ${i + 1}`}
                    defaultValue={stop.name || stop.address || ''}
                  />
                </Autocomplete>
                <button
                  type="button"
                  className="stop-remove"
                  onClick={() => setStops(stops.filter((_, j) => j !== i))}
                  aria-label={`Remove stop ${i + 1}`}
                >
                  <MatIcon name="close" size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* "Add a stop" always visible — if no destination yet, focuses the search input */}
        {stops.length < 3 && (
          <button
            type="button"
            className="btn-link stops-add"
            onClick={() => {
              if (!destination) {
                searchInputRef.current?.focus();
              } else {
                setStops([...stops, { lat: null, lng: null, name: '', address: '' }]);
              }
            }}
            title={!destination ? 'Select a destination first' : undefined}
            aria-label={!destination ? 'Add a stop — select a destination first' : 'Add a stop'}
          >
            <MatIcon name="add_location" size={20} /> Add a stop (optional)
          </button>
        )}

        {/* Schedule for later */}
        <div className="schedule-wrap">
          {!scheduleOpen ? (
            <button
              type="button"
              className="btn-link schedule-toggle"
              onClick={() => setScheduleOpen(true)}
            >
              <MatIcon name="calendar_today" size={20} /> Schedule for later (optional)
            </button>
          ) : (
            <div className="schedule-expanded">
              <div className="schedule-input-row">
                <input
                  id="schedule-datetime"
                  type="datetime-local"
                  className="schedule-datetime-input"
                  min={minDatetime}
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  aria-label="Schedule meetup for a specific date and time"
                />
                <button
                  type="button"
                  className="btn-link schedule-clear"
                  onClick={() => { setScheduledTime(''); setScheduleOpen(false); }}
                  aria-label="Clear scheduled time"
                >
                  <MatIcon name="close" size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Arrival radius */}
        <div className="arrival-radius-wrap">
          <p className="arrival-radius-heading">When should people be marked as &apos;arrived&apos;?</p>
          <div className="arrival-radius-selector" role="group" aria-label="Arrival radius">
            {ARRIVAL_RADIUS_OPTIONS.map((opt) => (
              <button
                key={opt.meters}
                className={`arrival-radius-btn${arrivalRadius === opt.meters ? ' arrival-radius-btn-selected' : ''}`}
                onClick={() => setArrivalRadius(opt.meters)}
                aria-pressed={arrivalRadius === opt.meters}
                aria-label={`${opt.label} — ${opt.meters} metres`}
              >
                {arrivalRadius === opt.meters && (
                  <span className="arrival-radius-check" aria-hidden="true">✓</span>
                )}
                <span className="arrival-radius-icon" aria-hidden="true"><MatIcon name="flag" size={18} /></span>
                <span className="arrival-radius-meters">{opt.meters}m</span>
                <span className="arrival-radius-label">{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="arrival-radius-hint">
            <MatIcon name="info" size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            100m works great for most meetups. Use 250m+ for large venues like parks or malls.
          </p>
        </div>

        {/* Expected guest count */}
        <div className="lobby-plusones" style={{ marginTop: 16 }}>
          <span className="lobby-plusones-label">Expected guests (optional)</span>
          <div className="lobby-plusones-stepper">
            <button
              type="button"
              className="lobby-stepper-btn"
              onClick={() => setExpectedCount((v) => (v != null && v > 2 ? v - 1 : null))}
              disabled={!expectedCount}
              aria-label="Decrease expected guest count"
            >
              <MatIcon name="remove" size={18} />
            </button>
            <span className="lobby-plusones-val" aria-live="polite">
              {expectedCount ?? '—'}
            </span>
            <button
              type="button"
              className="lobby-stepper-btn"
              onClick={() => setExpectedCount((v) => (v == null ? 2 : Math.min(20, v + 1)))}
              disabled={expectedCount != null && expectedCount >= 20}
              aria-label="Increase expected guest count"
            >
              <MatIcon name="add" size={18} />
            </button>
          </div>
        </div>

        {/* ── Event Details (Social Edition) ── */}
        <div className="create-event-details-wrap">
          <button
            type="button"
            className="create-event-toggle"
            onClick={() => setShowEventDetails((v) => !v)}
            aria-expanded={showEventDetails}
          >
            <MatIcon name={showEventDetails ? 'expand_less' : 'expand_more'} size={20} />
            Event Details
            {!showEventDetails && (themeEmoji !== '📍' || notes.trim() || activeLogisticsCount > 0 || pollQuestion) && (
              <span className="create-event-badge" aria-label="Event details configured">•</span>
            )}
          </button>

          {showEventDetails && (
            <div className="create-event-details">

              {/* ── Theme Emoji ── */}
              <div>
                <p className="create-section-label">Meetup Emoji</p>
                <div className="theme-emoji-row" role="group" aria-label="Theme emoji">
                  {THEME_EMOJIS.map((em) => (
                    <button
                      key={em}
                      className={`theme-emoji-btn${themeEmoji === em ? ' theme-emoji-btn-active' : ''}`}
                      onClick={() => setThemeEmoji(em)}
                      aria-label={em}
                      aria-pressed={themeEmoji === em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Group Note ── */}
              <div>
                <p className="create-section-label">Group Note</p>
                <div className="notes-input-wrap">
                  <textarea
                    ref={notesRef}
                    className="notes-textarea"
                    placeholder="Add a note for your group (optional)"
                    aria-label="Group note (optional)"
                    maxLength={200}
                    rows={1}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      const el = notesRef.current;
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }
                    }}
                  />
                  {notes.length > 0 && (
                    <span className={`notes-counter${notes.length > 180 ? ' notes-counter-warn' : ''}`}>
                      {notes.length} / 200
                    </span>
                  )}
                </div>
              </div>

              {/* ── Logistics ── */}
              <div>
                <p className="create-section-label">Logistics</p>
                <div className="logistics-toggles">
                  {LOGISTICS_FIELDS.map(({ key, label, icon }) => (
                    <button
                      key={key}
                      type="button"
                      className={`logistics-toggle-btn${logisticsOpen[key] ? ' logistics-toggle-btn-active' : ''}`}
                      onClick={() => toggleLogistics(key)}
                      aria-pressed={logisticsOpen[key]}
                    >
                      <MatIcon name={icon} size={15} />
                      {label}
                    </button>
                  ))}
                </div>
                {activeLogisticsCount > 0 && (
                  <div className="logistics-inputs">
                    {LOGISTICS_FIELDS.filter(({ key }) => logisticsOpen[key]).map(({ key, label, icon, placeholder }) => (
                      <div key={key} className="logistics-input-row">
                        <MatIcon name={icon} size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                        <span className="logistics-input-label">{label}</span>
                        <input
                          className="logistics-input"
                          type={key === 'registry' ? 'url' : 'text'}
                          placeholder={placeholder}
                          value={logisticsVals[key]}
                          onChange={(e) => updateLogisticsVal(key, e.target.value)}
                          maxLength={key === 'registry' ? 500 : 100}
                          aria-label={label}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Poll ── */}
              <div>
                <p className="create-section-label">Poll (optional)</p>
                <input
                  className="poll-question-input"
                  type="text"
                  placeholder="Poll question, e.g. Which day works?"
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  maxLength={100}
                  aria-label="Poll question"
                />
                {pollQuestion.trim() && (
                  <div className="poll-options-list" style={{ marginTop: 8 }}>
                    {pollOptions.map((opt, i) => (
                      <div key={i} className="poll-option-row">
                        <input
                          className="poll-option-input"
                          type="text"
                          placeholder={`Option ${i + 1}`}
                          value={opt}
                          onChange={(e) => updatePollOption(i, e.target.value)}
                          maxLength={60}
                          aria-label={`Poll option ${i + 1}`}
                        />
                        {pollOptions.length > 2 && (
                          <button
                            type="button"
                            className="poll-option-remove"
                            onClick={() => removePollOption(i)}
                            aria-label={`Remove option ${i + 1}`}
                          >
                            <MatIcon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 6 && (
                      <button type="button" className="add-field-btn" onClick={addPollOption}>
                        <MatIcon name="add" size={16} /> Add option
                      </button>
                    )}
                    {pollOptions.filter((o) => o.trim()).length < 2 && (
                      <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 0' }}>
                        Enter at least 2 options to create a poll.
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {error && <p className="error-msg">{error}</p>}
        <button
          className="btn btn-primary btn-full"
          disabled={!destination || loading}
          onClick={() => setShowJoinPrompt(true)}
          aria-label={scheduledTime ? 'Schedule meetup' : 'Start meetup'}
        >
          {loading ? 'Creating…' : scheduledTime ? 'Schedule Meetup' : 'Start Meetup'}
        </button>
      </div>

      {showJoinPrompt && (
        <JoinPrompt
          title="What's your name?"
          subtitle="You'll appear on the map as the host"
          onSubmit={handleNameSubmit}
          onCancel={() => setShowJoinPrompt(false)}
          loading={false}
        />
      )}

      {showPinModal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pin-modal-title">
          <div className="prompt-card">
            <h3 id="pin-modal-title">Recovery PIN (Optional)</h3>
            <p className="prompt-subtitle">
              Set a 4-digit PIN to reclaim host access if you lose your session. Skip if you don&apos;t need it.
            </p>
            <form onSubmit={handlePinSubmit} autoComplete="off">
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="4-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                maxLength={4}
                aria-label="4-digit recovery PIN"
                autoFocus
              />
              {pin.length === 4 && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginTop: '8px' }}>
                  Save this PIN — you won&apos;t be able to retrieve it later.
                </p>
              )}
              {error && <p className="error-msg">{error}</p>}
              <div className="prompt-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleSkipPin}
                  disabled={loading}
                >
                  Skip
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pin.length !== 4 || loading}
                >
                  {loading ? 'Creating…' : 'Save PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
