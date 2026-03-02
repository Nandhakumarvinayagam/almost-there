# Almost There — Project Context for Claude Code

## What This App Is

"Almost There" is a session-based live location sharing web app. Someone creates a meetup destination, shares a link, and everyone can see each other approaching in real-time on a map with ETAs. Think "Uber driver tracking" but for friends meeting up.

## Core Principles

- **Zero friction**: No sign-up, no app store download. Click a link, enter a name, you're in.
- **Simple and scalable**: Start with Firebase + React. No custom backend.
- **Honest about limitations**: This is a web app — background location tracking is limited. We embrace that with good UX (stale pin indicators, "keep app open" guidance).

## Tech Stack

| Layer          | Choice                     | Notes                                                         |
| -------------- | -------------------------- | ------------------------------------------------------------- |
| Frontend       | React 19 (Vite 7)          | Single page app with React Router 7                           |
| Maps           | @react-google-maps/api     | Maps JS API, Places API, Directions API                       |
| Real-time sync | Firebase Realtime Database | Push location updates to all participants                     |
| Auth           | None (MVP)                 | Anonymous join — user enters a name, gets a sessionStorage ID |
| Hosting        | Firebase Hosting           | Free tier to start                                            |

## Google Maps APIs Required

- **Maps JavaScript API** — render the map
- **Places API** — autocomplete for destination search
- **Directions API** — calculate ETA from each participant to destination (called ONCE per trip start, not polled)

## Firebase Data Model

```
sessions/
  {sessionId}/
    destination: { lat, lng, name, address }
    nickname: string              // optional meetup name set by host (40 char max)
    notes: string                 // optional group note (200 char max); host can edit
    hostId: "participant_abc123"
    status: "active" | "completed"
    createdAt: timestamp
    expiresAt: timestamp          // 2-hour default TTL
    arrivalRadius: 50 | 100 | 250 | 500  // metres; chosen at creation (default 100)

    participants/
      {participantId}/
        name: "Nandha"
        colorIndex: 0-7           // assigned on join; sourced from PARTICIPANT_COLORS
        location: { lat, lng }    // null until trip started
        lastUpdated: timestamp
        status: "not-started" | "en-route" | "almost-there" | "paused" | "arrived" | "spectating"
        travelMode: "DRIVING" | "BICYCLING" | "TRANSIT" | "WALKING"  // set on trip start
        transitInfo: { line, vehicleType, departureStop }             // TRANSIT only

        // ETA fields (populated on "Start Trip")
        eta: seconds                         // initial duration from Directions API
        expectedArrivalTime: timestamp       // Date.now() + (eta * 1000); ticks down client-side
        routePolyline: "encoded_polyline..."
        routeDistance: "14.2 mi"             // locale-aware text from Directions API
        routeDistanceMeters: 22800           // numeric for math

        // Trip tracking
        tripStartedAt: timestamp

        // ETA bump state
        manualDelayMs: 0          // cumulative offset from ETA bumps
        bumpCount: 0              // number of bumps used (max 3)

        // Optional status
        statusEmoji: "☕"         // quick status emoji (cleared on arrival)
        keepVisible: false        // override 5-min auto-hide for arrived pins

    events/                       // activity log (non-critical; future chat goes here)
      {pushKey}/
        type: "joined" | "trip_started" | "mode_switched" | "almost_there" | "arrived" | ...
        participantName: "Nandha"
        timestamp: ms
        detail: "DRIVING → TRANSIT"  // optional context
```

## File Structure

```
almost-there/
  src/
    App.jsx                 // Router: Home, Create, Session
    pages/
      Home.jsx              // Landing — Create or Join + Recent Meetups section
      Create.jsx            // Destination picker + nickname + notes + arrival radius + favorites
      Session.jsx           // Full-screen live tracking map (main app, ~1,700 lines)
    components/
      ETAPanel.jsx          // Collapsible half-sheet (mobile) / sidebar (desktop); activity feed
      ParticipantMarker.jsx // Colored dot markers with name bubble + stale/paused/arrived states
      DestinationMarker.jsx // 📍 emoji OverlayView anchored at destination coordinate
      RoutePolyline.jsx     // Decoded polyline overlay per participant, color-matched
      JoinPrompt.jsx        // "Enter your name" modal on session join
      ShareLink.jsx         // Native Web Share + clipboard fallback + copy-code button + calendar buttons
      LocationPermissionPrompt.jsx  // pre-ask / denied / unavailable permission states
      RecenterButton.jsx    // Floating crosshair button; toggles between overview and follow-me
      SessionRecap.jsx      // End-of-meetup podium + trip times overlay
      Toast.jsx             // Fixed ARIA-live notification popup with auto-dismiss
      MatIcon.jsx           // Material Symbols outlined icon wrapper (size, fill, style props)
    hooks/
      useGeolocation.js     // watchPosition + throttled writes + arrival/off-route detection
      useSession.js         // Firebase session CRUD — join, startTrip, updateLocation, end, etc.
      useColorScheme.js     // matchMedia(prefers-color-scheme) reactive wrapper
      useToast.js           // Toast state manager with auto-dismiss timer
      useNow.js             // Returns live Date.now() on an interval (default 1s); used for countdowns
    utils/
      calendar.js           // generateGoogleCalendarURL + generateICSBlob (RFC 5545, VALARM, line-folding)
      firebase.js           // Firebase app init + db reference
      directions.js         // Directions API helper — returns { eta, routePolyline, transitInfo, routeDistance }
      geo.js                // haversineDistance, decodePolyline, isOffRoute
      sessionId.js          // generateSessionId() — 6-char uppercase alphanumeric
      sessionHistory.js     // localStorage recent sessions (max 20, LRU)
      favorites.js          // localStorage favorite destinations (max 10, dedup by ~11m)
      colorPrefs.js         // localStorage participant name → colorIndex (LRU, max 20)
      participantColor.js   // getParticipantColor(participant, fallbackIndex) — single source of truth
      clipboard.js          // copyToClipboard() — Clipboard API with textarea fallback
      haptic.js             // haptic(pattern) — navigator.vibrate wrapper (no-op on iOS)
      navigation.js         // getNavigationURL() — Apple Maps (iOS) or Google Maps deep link
    config/
      constants.js          // All configurable values (see below)
      mapStyles.js          // DARK_MAP_STYLES JSON for Google Maps night mode
  .env                      // API keys (see Environment Variables section)
  firebase.json             // Firebase Hosting config — serves dist/, all routes → index.html
  database.rules.json       // Firebase RTDB security rules
```

## Key Constants (constants.js)

```javascript
LOCATION_UPDATE_INTERVAL   = 10_000    // ms — throttle for Firebase writes
STALE_THRESHOLD            = 30_000    // ms — dim marker after no update
OFF_ROUTE_THRESHOLD_METERS = 500       // trigger auto-recalculate
SESSION_TTL                = 7_200_000 // 2 hours in ms
ALMOST_THERE_METERS        = 500       // threshold for "almost-there" status (scaled by ALMOST_THERE_MULTIPLIER)
ARRIVED_METERS             = 100       // default; overridden by session.arrivalRadius
ALMOST_THERE_MULTIPLIER    = 3         // almostThere = min(arrivalRadius * 3, 1000)
ARRIVAL_PIN_HIDE_DELAY_MS  = 300_000   // 5 min; override with keepVisible flag
PARTICIPANT_COLORS         = [8 Google brand colors]
STATUS = { NOT_STARTED, EN_ROUTE, ALMOST_THERE, PAUSED, ARRIVED, SPECTATING }
SESSION_STATUS = { ACTIVE, COMPLETED }
MODE_SWITCH_COOLDOWN_MS    = 60_000
MAX_ETA_BUMPS              = 3
BUMP_OPTIONS_MINUTES       = [5, 10]
STATUS_EMOJIS              = [☕ ⛽ 🅿️ 🚦 🏃 🛒]
ARRIVAL_RADIUS_OPTIONS     = [50, 100, 250, 500]  // metres
```

## Screens

### Screen 1 — Home (`/`)

- App name and branding
- "Create Meetup" button → navigates to `/create`
- "Join Meetup" input → accepts 6-char code or full URL → navigates to `/session/{id}`
- "Recent Meetups" section (localStorage): up to 5 entries; "Start again" re-opens Create pre-filled with that destination; "Clear history" button

### Screen 2 — Create (`/create`)

- Google Map with Places Autocomplete search bar
- User searches or taps map to set destination
- Favorite quick-pick chips (horizontally scrollable); star button to save/remove from favorites
- Optional meetup nickname input (max 40 chars)
- Optional group note textarea (max 200 chars)
- Arrival radius selector: 50m / 100m / 250m / 500m with emoji icons
- "Start Meetup" button → writes session to Firebase → creator enters name via JoinPrompt → redirects to `/session/{id}`

### Screen 3 — Session (`/session/{id}`)

- Full-screen Google Map
- **Header bar**: destination name (tap to copy address), navigate button (Apple Maps on iOS / Google Maps elsewhere), session code chip (tap to copy), Share Link button, kebab menu (Share, End Meetup, Leave Meetup)
- **Banners** (stacked, dismissible): group note (auto-collapses 5s on mobile; ℹ️ re-open button), navigation tip ("Keep Almost There open…"), offline, Firebase reconnecting, celebration ("Everyone's here! 🎉")
- **Pre-trip bar**: travel mode selector (Drive 🚗 / Bike 🚲 / Transit 🚇 / Walk 🚶) + "I'm Leaving Now" button (disabled until current location fetched)
- **Map**: destination marker (📍 OverlayView), colored participant markers with initials + name bubbles, route polylines per participant, floating recenter/follow-me button
- **ETA Panel** (bottom sheet on mobile, fixed sidebar on desktop): sections — En Route (sorted by ETA + ordinal badges + ⚡ close-race tag), Almost There, Paused, Arrived, Waiting; per-participant actions: Pause/Resume, mode switch, ETA bump (+5/+10 min, max 3 bumps), Recalculate ETA, "I'm Here" (manual arrival), status emoji picker, SMS nudge (60s cooldown), Share ETA; Keep Visible toggle for arrived pins; activity feed (real-time event log)
- **Overlays**: JoinPrompt (name entry), LocationPermissionPrompt, leave-confirmation modal, SessionRecap (podium + trip times after host ends meetup)

## Key Technical Details

### Location Tracking

- `navigator.geolocation.watchPosition()` with `enableHighAccuracy: true`
- Throttle Firebase writes to every 10 seconds (LOCATION_UPDATE_INTERVAL)
- Arrival detection runs on EVERY GPS ping (not throttled) for responsiveness
- Stale detection: `useEffect` interval checks `Date.now() - participant.lastUpdated`; dims markers after STALE_THRESHOLD (30s)
- Show "last updated X ago" on each participant marker; dashed border + clock icon when stale
- **CRITICAL: All `useEffect` hooks MUST return cleanup functions** — `clearWatch` for geolocation, `clearInterval` for stale-check timers, `wakeLock.release()` for wake lock. Failing to do this causes memory leaks.

### ETA Calculation — Countdown Model

- Do NOT continuously poll the Directions API. Instead:
  1. Call Directions API ONCE when user taps "I'm Leaving Now"
  2. Get `duration`, `overview_polyline`, `routeDistance`, and (for TRANSIT) `arrival_time`
  3. Calculate `expectedArrivalTime = Date.now() + (duration * 1000)`
  4. Store `expectedArrivalTime`, `routePolyline`, `routeDistance` in Firebase
  5. Frontend ticks down `expectedArrivalTime - Date.now()` every second via `setInterval`
- Only re-call Directions API if:
  - User is >500m off the original route polyline (auto-detected by `isOffRoute` in useGeolocation)
  - User manually taps "Recalculate ETA"
  - User switches travel mode mid-trip
- ETA bumps: `manualDelayMs` is added to `expectedArrivalTime` display (max 3 bumps of +5 or +10 min; reset on recalculate or mode switch)
- Transit: uses scheduled `arrival_time` from API; displayed as fixed clock time ("9:26 AM") not a countdown
- This reduces Directions API usage by ~90% compared to continuous polling

### Off-Route Detection (geo.js)

```javascript
isOffRoute(currentPos, polylinePoints, thresholdMeters)
// Decodes routePolyline once per polyline change (useMemo in useGeolocation)
// Finds closest Haversine distance from currentPos to any polyline point
// Returns true if min distance > OFF_ROUTE_THRESHOLD_METERS (500m)
// Fires onOffRoute callback ONCE per polyline to prevent repeated API calls
```

### Session Management

- Session codes: 6-character alphanumeric (uppercase), generated client-side
- `hostId` in session root = creator's participant ID — gates "End Meetup" action
- Sessions auto-expire after 2 hours (`expiresAt`); client redirects to home on expiry
- Host ends session → sets `status: "completed"` → all clients stop location sharing
- `leaveSession()` removes the participant node entirely from Firebase

### Participant Identity

- No auth. User enters display name on join.
- Random participant ID generated and stored in `sessionStorage`
- Refresh → same participant ID → reconnects as same participant
- `colorIndex` stored in Firebase + `colorPrefs` localStorage for consistency across sessions

### Screen Wake Lock

- `navigator.wakeLock.request('screen')` acquired when session is active
- Re-acquired on `visibilitychange` (tab comes back to foreground)
- Released on session end, expiry, or component unmount
- Gracefully skipped on unsupported browsers

### Offline / Connection Awareness

- Browser offline: `window online/offline` events → shows offline banner, pauses location writes
- Firebase connection: `.info/connected` listener with 3s grace period to suppress false flashes
- "Back online" flash banner for 2s when Firebase reconnects

## Environment Variables (.env)

```
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_FIREBASE_API_KEY=your_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

## Firebase Security Rules (database.rules.json)

```json
{
  "rules": {
    "sessions": {
      ".read": false,
      ".write": false,
      "$sessionId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Note: Permissive within a session — all participants can read/write. Before any public launch, tighten further:
- Validate `hostId` before allowing `endSession`/`updateNotes`
- Validate `participantId` matches the writer before location updates
- Enforce `expiresAt` server-side

## Current Build Status

**All MVP + Tier 1 + Tier 2 + Tier 3 + UI Polish + Scheduling are complete.** The app is production-ready.

Implemented highlights beyond the original spec:
- Meetup nickname + group note (with host edit capability)
- Configurable arrival radius (4 options at session creation)
- ETA bumps (+5/+10 min, max 3, resets on recalculate)
- Quick status emoji per participant (☕ ⛽ 🅿️ 🚦 🏃 🛒)
- Pause/Resume location sharing (ghost mode)
- Travel mode switch mid-trip (60s cooldown)
- Manual "I'm Here" arrival button
- SMS nudge per participant (60s cooldown, `sms:` deep link)
- Real-time activity feed in ETA panel
- SessionRecap overlay (podium + trip times after meetup ends)
- Navigation deep-link (Apple Maps on iOS, Google Maps elsewhere)
- Haptic feedback on arrivals and button taps
- Firebase connection monitoring with grace period
- Color preferences persistence (localStorage LRU)
- Pre-trip background geolocation (location pre-fetched before "Start Trip")
- Keep Visible toggle for arrived participant pins
- Spectator mode (watch map without sharing location)
- Session skeleton loading UI (shimmer cards while Firebase + Maps load)
- **Header refactor**: session code chip removed; Navigate + Share as top-level icon buttons; session code accessible via kebab menu; all header text truncates on narrow screens; NoteIcon SVG replaces ℹ️ re-open button
- **UI polish**: Cancel/ghost buttons have visible outline border; emoji strip at 28px with pill backgrounds; group note banner fully vertically aligned; spectator link at opacity 0.6; arrival radius hint at readable contrast; header title auto-capitalizes first letter; Activity tab badge has correct margin/min-width
- **Map improvements**: current user's marker has higher z-index; Haversine-based label collision avoidance (no DOM measurements); "Location stale" badge is tappable with info toast; map tile spinner has `pointer-events: none` and text label; empty-session fitBounds falls back to destination zoom 14
- **Scheduled meetups** (`scheduledTime` field): optional datetime picker on Create; `expiresAt = scheduledTime + 2h` (not `now + 2h`); countdown banner in Session with Google Calendar + .ics export; "Leave Early" reveals full pre-trip flow; countdown parent never remounts on expiry (className swap); haptic fires exactly once at zero (ref-guarded); `scheduledTime` persisted in session history; Home shows "Scheduled · time", "In progress", or "Start again" states; "Start again" never carries over `scheduledTime`
- **Calendar export** (`src/utils/calendar.js`): `generateGoogleCalendarURL` (URL capped at 1800 chars); `generateICSBlob` (RFC 5545, line-folded at 75 octets, `foldLine()` + `escapeICS()` helpers, VALARM -PT30M reminder); calendar buttons in ShareLink.jsx when `scheduledTime` exists; "Calendar events won't update if meetup details change" disclaimer

## Phase 2 / Next Features

- **Floating reaction bubbles**: `statusEmoji` field and picker already built; add `ReactionBubble.jsx` OverlayView showing active emoji ~50px above the participant marker; fade in/out on set/clear; no new data model needed (Enhancement 2.1 in plan)
- **Traffic-aware ETA**: Add `departureTime: 'now'` to Directions API call; behind `ENABLE_TRAFFIC_AWARE_ETA` flag in constants.js; verify billing tier impact first (Enhancement 3.3)
- **PWA install**: `manifest.json` + `sw.js` caching app shell ONLY (NOT map tiles); `beforeinstallprompt` banner in App.jsx (Enhancement 3.4)
- **Participant count**: Optional expected guest count on Create; live "X of Y joined" counter in Session header; "Everyone's joined! 🎉" banner (once only — guard with `hasCelebratedJoinCount`); `expectedCount` field in Firebase session root (Usability F13 in plan)
- **Low battery indicator**: `src/hooks/useBattery.js` using Web Battery API; writes `lowBattery: true/false` to Firebase participant on change; 🪫 icon next to participant name in ETA panel; Chrome/Android only — complete no-op on Safari/Firefox (Usability F11 in plan)
- **Push notifications**: FCM + service worker + Blaze plan required (Tier 4)
- **Dynamic OG images per session**: Cloud Functions (Tier 4)

## Style Guidelines

- Mobile-first design — primarily used on phones
- Clean, minimal UI — the map is the hero
- CSS custom properties for theming (light + dark); all colors via variables
- Accent color (#0066CC or similar) for CTAs
- Touch targets ≥ 44px everywhere
- Accessible: ARIA labels, ARIA live regions for toasts, keyboard navigation

## Important Constraints

- Do NOT add authentication for MVP
- Do NOT build full chat (text messages) yet — emoji status reactions first
- Do NOT add contact book integration
- Do NOT try to solve background location — acknowledge the limitation via UX banners
- Keep the dependency count minimal
- All API keys go in `.env`, never hardcoded
- Do NOT call Directions API more than once per trip start — use the countdown model
