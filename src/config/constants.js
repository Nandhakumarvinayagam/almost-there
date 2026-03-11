// App-wide configuration constants

// How often (ms) to write location updates to Firebase
export const LOCATION_UPDATE_INTERVAL = 10_000; // 10 seconds

// How long (ms) before a participant marker is considered stale
export const STALE_THRESHOLD = 30_000; // 30 seconds

// Minimum distance (meters) a user must move to trigger a new ETA calculation
export const ETA_DISTANCE_THRESHOLD = 50; // meters

// Maximum time (ms) between ETA recalculations regardless of movement
export const ETA_REFRESH_INTERVAL = 120_000; // 2 minutes

// How far (meters) the user can stray from the stored route before
// useGeolocation auto-triggers a single new Directions API call
export const OFF_ROUTE_THRESHOLD_METERS = 500;

// Session time-to-live in milliseconds (2 hours)
export const SESSION_TTL = 2 * 60 * 60 * 1000;

// Marker colours — assigned by join order, cycles after 8
export const PARTICIPANT_COLORS = [
  '#4285F4', // Google Blue
  '#EA4335', // Google Red
  '#FBBC04', // Google Yellow
  '#34A853', // Google Green
  '#FF6D01', // Deep Orange
  '#46BDC6', // Teal
  '#7B1FA2', // Purple
  '#E91E63', // Pink
];

// Arrival detection thresholds (metres, Haversine distance to destination)
export const ALMOST_THERE_METERS      = 500; // triggers "almost-there" status once
export const ARRIVED_METERS           = 100; // triggers "arrived" status + stops tracking
// Multiplier applied to the session's arrivalRadius to derive the "almost-there" threshold.
// almost-there threshold = min(arrivalRadius * ALMOST_THERE_MULTIPLIER, 1000)
export const ALMOST_THERE_MULTIPLIER  = 3;

// Customisable arrival radius options shown on the Create page.
// arrivalRadius stored in Firebase overrides ARRIVED_METERS on the session.
export const ARRIVAL_RADIUS_OPTIONS = [
  { label: 'Exact',      meters: 50,  icon: '📍' },
  { label: 'Close',      meters: 100, icon: '🏠' },
  { label: 'Default',    meters: 250, icon: '🎯' },
  { label: 'Area-wide',  meters: 500, icon: '📡' },
];

// Travel mode values — passed to the Directions API as travelMode
export const TRAVEL_MODES = {
  DRIVING:   'DRIVING',
  BICYCLING: 'BICYCLING',
  TRANSIT:   'TRANSIT',
  WALKING:   'WALKING',
};

// Participant status values
export const STATUS = {
  NOT_STARTED:  'not-started',  // joined but hasn't tapped "I'm Leaving Now" yet
  EN_ROUTE:     'en-route',
  ALMOST_THERE: 'almost-there', // within ALMOST_THERE_METERS of destination
  PAUSED:       'paused',       // voluntarily stopped sharing location (Ghost Mode)
  ARRIVED:      'arrived',      // within ARRIVED_METERS — tracking stops
  SPECTATING:   'spectating',   // watching the map without sharing location
};

// Session status values
export const SESSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
};

// Cooldown between mid-trip travel mode switches (ms)
// Prevents rapid API hammering if the user taps modes in quick succession.
export const MODE_SWITCH_COOLDOWN_MS = 60_000; // 60 seconds

// How long (ms) after arrival before a participant's map pin is auto-hidden for privacy.
// The arrived participant can override this by setting keepVisible: true on their node.
export const ARRIVAL_PIN_HIDE_DELAY_MS = 300_000; // 5 minutes

// Maximum number of manual ETA bumps before the user must recalculate
export const MAX_ETA_BUMPS = 3;

// Duration options (minutes) shown in the Quick ETA Bump selector
export const BUMP_OPTIONS_MINUTES = [5, 10];

// Quick status emojis — participants can set one to communicate context to others
export const STATUS_EMOJIS = [
  { emoji: '☕', label: 'Coffee run' },
  { emoji: '⛽', label: 'Getting gas' },
  { emoji: '🅿️', label: 'Parking' },
  { emoji: '🚦', label: 'Traffic' },
  { emoji: '🏃', label: 'Running late' },
  { emoji: '🛒', label: 'Quick errand' },
];

