import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLoadScript, GoogleMap, Autocomplete, Marker } from '@react-google-maps/api';
import { SESSION_TTL, ARRIVAL_RADIUS_OPTIONS } from '../config/constants';
import { DARK_MAP_STYLES } from '../config/mapStyles';
import { useColorScheme } from '../hooks/useColorScheme';
import { createSession } from '../hooks/useSession';
import { saveSession } from '../utils/sessionHistory';
import JoinPrompt from '../components/JoinPrompt';
import {
  saveFavorite, getFavorites, removeFavorite, isFavorite, findFavorite,
} from '../utils/favorites';
import MatIcon from '../components/MatIcon';

// Must be defined outside component to keep reference stable
const LIBRARIES = ['places'];

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

function generateParticipantId() {
  return Math.random().toString(36).slice(2, 11);
}

/** Format a Date as the value for a datetime-local input ("YYYY-MM-DDTHH:MM"). */
function toLocalDatetimeString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Create() {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const navigate  = useNavigate();
  const location  = useLocation();
  const colorScheme = useColorScheme();

  // ---- Pre-fill from history "Start again" ----
  const prefill = location.state?.prefillDestination ?? null;

  const [destination, setDestination] = useState(prefill);
  const [mapCenter,   setMapCenter]   = useState(
    prefill ? { lat: prefill.lat, lng: prefill.lng } : DEFAULT_CENTER
  );
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [nickname,     setNickname]     = useState('');
  const [notes,        setNotes]        = useState('');
  const [arrivalRadius, setArrivalRadius] = useState(100); // default 100 m

  // ---- Schedule for later ----
  const [scheduleOpen,  setScheduleOpen]  = useState(false);
  const [scheduledTime, setScheduledTime] = useState(''); // datetime-local input value

  // ---- Favorites ----
  const [favorites,    setFavorites]    = useState(() => getFavorites());
  const [isCurrentFav, setIsCurrentFav] = useState(
    () => prefill ? isFavorite(prefill.lat, prefill.lng) : false
  );

  const autocompleteRef = useRef(null);
  const searchInputRef  = useRef(null);
  const notesRef        = useRef(null);

  // ---- Pre-fill search input text once the map (and input) have mounted ----
  useEffect(() => {
    if (!isLoaded || !prefill || !searchInputRef.current) return;
    searchInputRef.current.value = prefill.name || prefill.address || '';
  }, [isLoaded, prefill]);

  // ---- Try to initialise map at user's current location ----
  // Skip if a pre-fill destination was provided — we already know where to centre.
  useEffect(() => {
    if (!navigator.geolocation || prefill) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!cancelled) setMapCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {} // silently fall back to DEFAULT_CENTER
    );
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setMapCenter({ lat: loc.lat, lng: loc.lng });
  }, [handleSetDestination]);

  const onMapClick = useCallback((e) => {
    handleSetDestination({
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
      name: 'Custom location',
      address: '',
    });
  }, [handleSetDestination]);

  // ---- Favorite chip picked ----
  const handleFavoriteChip = useCallback((fav) => {
    handleSetDestination(fav);
    setMapCenter({ lat: fav.lat, lng: fav.lng });
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

  async function handleStartMeetup(hostName) {
    if (!destination) return;
    setLoading(true);
    setError(null);

    try {
      const participantId  = generateParticipantId();
      // CRITICAL: never pass NaN to Firebase — empty string → null
      const scheduledTimeMs = scheduledTime ? new Date(scheduledTime).getTime() : null;
      const now = Date.now();

      const sessionId = await createSession({
        destination,
        hostId:       participantId,
        hostName,
        nickname,
        notes,
        arrivalRadius,
        ...(scheduledTimeMs && { scheduledTime: scheduledTimeMs }),
      });

      // Save to history immediately so scheduled sessions are visible on Home
      // before the session ends. expiresAt mirrors the logic in createSession.
      const expiresAt = scheduledTimeMs
        ? scheduledTimeMs + SESSION_TTL
        : now + SESSION_TTL;
      saveSession({
        sessionId,
        destination,
        nickname: nickname.trim() || null,
        date: now,
        participants: [hostName],
        wasHost: true,
        ...(scheduledTimeMs && { scheduledTime: scheduledTimeMs }),
        expiresAt,
      });

      // Persist participant identity across refreshes
      sessionStorage.setItem(`participant_${sessionId}`, participantId);
      sessionStorage.setItem(`name_${sessionId}`, hostName);

      navigate(`/session/${sessionId}`);
    } catch (err) {
      console.error('Failed to create session:', err);
      setError('Failed to create meetup. Please try again.');
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
  const maxDatetime = toLocalDatetimeString(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  return (
    <div className="create">
      {/* Search bar + favorite chips — float over the map */}
      <div className="create-header">
        {/* Nickname — optional, entered before destination */}
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

        {/* Favorite quick-pick chips — horizontally scrollable */}
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

      {/* Full-screen map */}
      <GoogleMap
        mapContainerClassName="map-container"
        center={mapCenter}
        zoom={13}
        onClick={onMapClick}
        options={{
          clickableIcons: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          styles: colorScheme === 'dark' ? DARK_MAP_STYLES : [],
        }}
      >
        {destination && (
          <Marker
            position={{ lat: destination.lat, lng: destination.lng }}
          />
        )}
      </GoogleMap>

      {/* Bottom action bar */}
      <div className="create-footer">
        {destination && (
          <div className="destination-row">
            <p className="destination-label">
              <MatIcon name="location_on" size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {destination.name || destination.address || 'Custom location'}
            </p>
            {/* Star button — save / unsave as favorite */}
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
        {/* Optional group note */}
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
              // Auto-grow: reset to auto so shrinking works, then clamp to scrollHeight.
              // CSS max-height caps the element at 2 lines.
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

        {/* Schedule for later — collapsible */}
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
                  max={maxDatetime}
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

        {/* Arrival radius selector */}
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
          <p className="arrival-radius-hint"><MatIcon name="info" size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 100m works great for most meetups. Use 250m+ for large venues like parks or malls.</p>
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
          onSubmit={handleStartMeetup}
          onCancel={() => setShowJoinPrompt(false)}
          loading={loading}
        />
      )}
    </div>
  );
}
