# Almost There — Project Context for Claude Code

## What This App Is

"Almost There" is a session-based live location sharing web app that doubles as a social event planning platform. Someone creates a meetup destination, shares a link, and guests RSVP in an invite lobby before the event starts. Once the event goes live, everyone can see each other approaching in real-time on a map with ETAs. Think "Partiful invite + Uber driver tracking" for friends meeting up.

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
| Auth           | Firebase Anonymous Auth    | Auto sign-in; UID used as participant ID; `ensureAuth()` retries on failure |
| Hosting        | Firebase Hosting           | Free tier to start                                            |

## Google Maps APIs Required

- **Maps JavaScript API** — render the map
- **Places API** — autocomplete for destination search
- **Directions API** — calculate ETA from each participant to destination (called ONCE per trip start, not polled)

## Session State Machine

Sessions transition through four states. **`session.state` drives all routing in Session.jsx.**

| State         | View Rendered                  | Who Can Trigger                                                                 |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `draft`       | Create.jsx (not yet saved)     | Host creates session                                                            |
| `scheduled`   | `Lobby.jsx` (RSVP + planning)  | Auto-set on creation when `scheduledTime` is provided                           |
| `active`      | Map + ETA panel                | Host/co-host manually, OR any client auto-triggers when `Date.now() > scheduledTime` |
| `completed`   | `SessionRecap.jsx` overlay     | Host ends session or `expiresAt` reached                                        |

**Ghost Transition (`scheduled → active`):** When any client opens a session in `scheduled` state and `Date.now() > scheduledTime`, it writes `state: "active"` to Firebase. This is idempotent — all clients write the same value. No Cloud Function needed.

**Legacy sessions** (created before the Social Edition update) lack `state`. The `normalizeSession()` utility defaults missing `state` to `"active"`, preserving current behavior.

## Firebase Data Model

```
sessions/
  {sessionId}/
    // Core identity
    hostId: string                // UID of creator; immutable after creation
    hostSecretHash: string | null // SHA-256 of 4-digit recovery PIN
    state: "draft" | "scheduled" | "active" | "completed"
    headcount: number             // Denormalized counter for "going" participants; updated via runTransaction()

    // Original fields
    destination: { lat, lng, name, address }
    nickname: string              // optional meetup name (40 char max)
    notes: string                 // optional group note (200 char max); host can edit
    createdAt: number             // epoch ms (NOT ISO string)
    scheduledTime: number | null  // epoch ms; when set, session starts as 'scheduled'
    expiresAt: number             // epoch ms; scheduledTime + 2h if scheduled, else createdAt + 2h
    arrivalRadius: 50 | 100 | 250 | 500  // metres (default 250)
    expectedCount: number | null  // optional expected guest count (2–20)

    // Stops/Waypoints (Round 3)
    stops/                        // optional intermediate stops (max 3)
      [index]: { lat, lng, name, address }
      // IMPORTANT: Firebase RTDB stores arrays as objects {0: ..., 1: ...}.
      // normalizeSession() coerces back to array via Object.values().

    // Social Edition fields
    theme/
      color: string               // hex, e.g. "#7C3AED"
      emoji: string               // hero emoji, e.g. "🍕"
      style: "classic" | "fancy" | "digital"

    logistics/
      dressCode: string | null
      food: string | null
      parking: string | null
      registry: string | null     // arbitrary URL (Venmo, Spotify, etc.)

    customFields/                 // host-defined questions (max 3)
      [pushKey]: { question: string, type: "text" | "choice" }

    poll/
      question: string
      options/
        [optionId]: { text: string, votes: number }  // votes via runTransaction()

    reactions/                    // emoji taps on logistics cards
      [logisticKey]/
        [emoji]: number           // incremented via runTransaction()

    activityFeed/                 // timestamped event log
      [pushKey]: { type: string, userId: string, text: string, timestamp: number }
      state_scheduled_to_active:  // fixed key prevents duplicate "meetup is live" entries
        { type: "state", userId: "system", text: "The meetup is now live! 🟢", timestamp: number }

    permissions/
      coHosts/
        [uid]: true               // object map (NOT array); checked via .exists() in rules

    blockedUsers/
      [uid]: true                 // kicked participants; denied all read/write

    participants/
      {participantId}/
        // Identity
        name: "Nandha"
        colorIndex: 0-7           // assigned on join; sourced from PARTICIPANT_COLORS
        avatarId: number | null   // index into AVATARS array (0–19); null = show initial letter

        // Social Edition RSVP fields
        rsvpStatus: "going" | "maybe" | "cant-go"  // required; defaults "going" for legacy
        plusOnes: number          // default 0; does NOT need runTransaction() (single writer)
        guestNote: string | null  // legacy single-note field
        pollVote: string | null   // optionId; security rule prevents double-voting
        customResponses/          // answers to host's customFields
          [fieldId]: string
        visibility: "visible" | "hidden"  // default "visible"
        myReactions/              // tracks emoji taps; key = "[logisticKey]_[emoji]"
          [key]: true
        nearbyStatus: boolean     // "Who's Nearby" opt-in; default false

        // Location & ETA (active state only)
        location: { lat, lng } | null
        lastUpdated: number       // epoch ms
        status: "not-started" | "en-route" | "almost-there" | "paused" | "arrived" | "spectating"
        travelMode: "DRIVING" | "BICYCLING" | "TRANSIT" | "WALKING"
        transitInfo: { line, vehicleType, departureStop }  // TRANSIT only
        eta: seconds
        expectedArrivalTime: number  // epoch ms; ticks down client-side
        routePolyline: "encoded_polyline..."
        routeDistance: "14.2 mi"
        routeDistanceMeters: 22800

        // Trip tracking
        tripStartedAt: number     // epoch ms
        manualDelayMs: 0          // cumulative ETA bump offset
        bumpCount: 0              // bumps used (max 3)
        statusEmoji: "☕"         // quick status (cleared on arrival)
        keepVisible: false        // override 5-min auto-hide for arrived pins

    events/                       // legacy activity log (pre-Social Edition)
      {pushKey}/
        type: "joined" | "trip_started" | "mode_switched" | "almost_there" | "arrived" | ...
        participantName: "Nandha"
        timestamp: number         // epoch ms
        detail: "DRIVING → TRANSIT"
```

### Timestamp Convention

**All timestamps are stored as Numbers (epoch milliseconds), not ISO strings.** This is required because Firebase RTDB security rules use `now` (epoch ms) for time comparisons. The `normalizeSession()` utility auto-converts any legacy ISO strings to epoch ms on read.

Affected fields: `scheduledTime`, `expiresAt`, `createdAt`, `activityFeed[].timestamp`.

## File Structure

```
almost-there/
  src/
    App.jsx                 // Router: Home, Create, Session
    pages/
      Home.jsx              // Landing — Create or Join + Recent Meetups; Clone for expired hosted sessions
      Create.jsx            // Destination picker + nickname + notes + arrival radius + favorites
                            // + theme picker + logistics + custom fields + co-hosts + poll + schedule
      Session.jsx           // State machine router: Lobby (scheduled) | Map+ETA (active) | Recap (completed)
    components/
      // Social Edition — New
      Lobby.jsx             // Scheduled session view: RSVP, guest list, logistics, activity feed, polls
                            // Layout: hero emoji → details → RSVP action → logistics cards → activity feed
      ActivityFeed.jsx      // Debounced child_added+child_changed listener; Map-based storage; capped at 100
      Poll.jsx              // Transaction-based voting; final votes V1; double-vote prevention; percentage bars
      EventDetails.jsx      // Read-only event info tab for active session: hero emoji, group note + copy, logistics
                            // cards, poll results (read-only), host-only custom responses, headcount summary

      // Original components (updated in Round 5)
      Avatars.jsx           // 20 native emoji avatars (🐱→👻); AvatarIcon + AvatarPicker components
                            // AvatarIcon renders emoji <span>; color prop accepted as no-op for backward compat (not applied)
                            // AvatarPicker shows plain emoji grid; no color cycling; each slot renders its intrinsic emoji color
                            // Selected state: white border + scale(1.1) + white checkmark badge; unselected: transparent border/bg
      ETAPanel.jsx          // 2-state bottom sheet (peek 160px / full 85vh); DoorDash-inspired drag handle
                            // Single scrollable view — NO tabs; participant sections + event details + activity
      ParticipantMarker.jsx // Colored dot with avatar (if set) or initial letter; ICON_TO_EMOJI backward compat
                            // No blue border ring; drop-shadow via filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))
      DestinationMarker.jsx // MatIcon location_on OverlayView anchored at destination coordinate
      RoutePolyline.jsx     // Decoded polyline overlay per participant, color-matched
      JoinPrompt.jsx        // Name input with inline anonymous icon button (eye toggle) + avatar picker + RSVP status + plus-ones
      ShareLink.jsx         // Native Web Share + clipboard fallback + copy-code + calendar buttons
      LocationPermissionPrompt.jsx  // pre-ask / denied / unavailable permission states
      RecenterButton.jsx    // Floating crosshair button; toggles between overview and follow-me
      SessionRecap.jsx      // End-of-meetup podium + trip times overlay
      Toast.jsx             // Fixed ARIA-live notification popup with auto-dismiss
      MatIcon.jsx           // Material Symbols outlined icon wrapper (size, fill, style props)
    hooks/
      useGeolocation.js     // watchPosition + throttled writes + arrival/off-route detection
      useSession.js         // Firebase session CRUD + Social Edition ops (RSVP, kick, poll vote, reactions,
                            // headcount migration-on-read, ghost transition)
      useColorScheme.js     // matchMedia(prefers-color-scheme) reactive wrapper
      useToast.js           // Toast state manager with auto-dismiss timer
      useNow.js             // Returns live Date.now() on an interval (default 1s); used for countdowns
    utils/
      // Social Edition — New
      normalizers.js        // normalizeSession() + normalizeParticipant() — backward-compat defaults for
                            // all Social Edition fields; ISO→epoch ms timestamp conversion
      headcount.js          // computeHeadcountDelta() — 6-scenario delta math for runTransaction()
      registryLabel.js      // detectRegistryLabel(url) — domain→label+icon for logistics registry card
      theme.js              // hexToRgb(hex) + getContrastTextColor(hex) — CSS variable helpers for theme engine
      normalizers.test.js   // 35+ tests; run with: npm test

      // Original utilities
      calendar.js           // generateGoogleCalendarURL + generateICSBlob (RFC 5545, VALARM, line-folding)
      firebase.js           // Firebase app init + db + auth + whenAuthReady + ensureAuth() (retry-capable)
      directions.js         // getETAWithRoute(origin, dest, mode, waypoints) — supports multi-stop routes
      formatters.js         // timeAgo(timestamp, now) — "X min ago" / "X hr ago" / "Just now"
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
  database.rules.json       // Firebase RTDB security rules (Social Edition; full access control)
  enhancement plan.md       // Future scope and implementation history
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
STATUS_EMOJIS              = [{ emoji: '☕', label: 'Coffee run' }, ...]  // objects, NOT plain strings
ARRIVAL_RADIUS_OPTIONS     = [{ label: 'Exact', meters: 50, icon: '📍' }, { label: 'Close', meters: 100, icon: '🏠' }, { label: 'Default', meters: 250, icon: '🎯' }, { label: 'Area-wide', meters: 500, icon: '📡' }]
```

> **Deleted in Round 3:** `EMOJI_TO_ICON` and `STATUS_ICONS` were removed. Legacy icon-name data (e.g. `"coffee"`) is handled by `ICON_TO_EMOJI` maps in ParticipantMarker.jsx and ETAPanel.jsx.

## Screens

### Screen 1 — Home (`/`)

- App name and branding
- "Create Meetup" button → navigates to `/create`
- "Join Meetup" input → accepts 6-char code or full URL → navigates to `/session/{id}`
- "Recent Meetups" section (localStorage): up to 5 entries; three states per entry:
  - `scheduled-future` → "Scheduled · time" + "Open" button
  - `active` → "In progress" + "Open" button
  - `expired` + hosted → "Clone" button (carries theme, logistics, customFields, destination)
  - `expired` + guest → "Start again" button (prefills destination only; never carries scheduledTime)

### Screen 2 — Create (`/create`)

- Google Map with Places Autocomplete search bar
- Favorite quick-pick chips (horizontally scrollable); star button to save/remove from favorites
- Optional meetup nickname (max 40 chars) + group note textarea (max 200 chars)
- **Stops/waypoints** (up to 3): each with its own Places Autocomplete; numbered circle markers on map
- Arrival radius selector: 50m / 100m / 250m / 500m
- Expected guest count stepper (optional, range 2–20)
- **Social Edition additions:**
  - Theme emoji picker (10 presets); color fixed at #0066CC, style fixed at "classic"
  - Logistics toggles: Dress Code, Food, Parking, Registry URL
  - Custom question builder: 1–3 questions, type text or choice
  - Poll creator: question + dynamic options
  - Schedule picker: `datetime-local` input → stored as epoch ms
- "Start Meetup" → JoinPrompt (name + avatar + RSVP) → optional PIN → writes session → redirects to `/session/{id}`

### Screen 3 — Session (`/session/{id}`) — routes based on `session.state`

**If `state === "scheduled"` → Lobby.jsx:**
- Hero emoji with color aura + event title
- Time + "Add to Calendar" link + location name
- Guest avatars grouped by RSVP status (Going / Maybe / Can't Go)
- Logistics cards (Dress Code, Food, Parking, Registry) with emoji reactions
- Poll component (vote once, final in V1)
- Activity feed (scrollable, debounced, capped at 100 entries)
- Sticky RSVP bar (Going / Maybe / Can't Go) for un-joined users
- Host actions: Nudge Guests (Web Share), Copy Guest Summary, kick participants
- Reclaim Host link (if `hostSecretHash` set): PIN entry → self-add as co-host

**If `state === "active"` → Map + ETA panel:**
- Full-screen Google Map
- **Header bar**: destination name (tap to copy address), Navigate icon button, Share icon button, kebab menu (Copy Session Code, Edit Note [host], End Meetup [host], Leave Meetup)
- **Banners**: scheduled countdown (if `scheduledTime` set; "Leave Early" reveals pre-trip flow), group note (host-editable), navigation tip, offline, Firebase reconnecting, celebration ("Everyone's here! 🎉")
- **Pre-trip bar**: travel mode selector (Drive 🚗 / Bike 🚲 / Transit 🚇 / Walk 🚶) + "I'm Leaving Now" button
  - Maybe/Can't-Go users see "Change to Going to Share Location" instead
- **Map**: destination marker (MatIcon `location_on`), colored participant markers (avatar or initial), stop markers (numbered circles), route polylines, recenter button (top-right of map area)
- **ETA Panel** (2-state bottom sheet — peek 160px / full 85vh): single scrollable view with NO tabs; participant sections (En Route, Almost There, Paused, Arrived, Waiting); per-participant actions: Pause/Resume, mode switch, ETA bump, Recalculate, "I'm Here", status emoji picker, SMS nudge, Share ETA; Keep Visible toggle; collapsible Event Details + Recent Activity at bottom
- **Overlays**: JoinPrompt (name + avatar + RSVP + plus-ones + anonymous), LocationPermissionPrompt, leave-confirmation, SessionRecap

**If `state === "completed"` → SessionRecap.jsx overlay**

## Key Technical Details

### Session State Machine & Ghost Transition

- `session.state` drives rendering in Session.jsx: `"scheduled"` → Lobby, `"active"` → Map, `"completed"` → Recap
- **Ghost transition**: On session load, `useSession` checks `state === "scheduled" && Date.now() > scheduledTime`. If true, writes `state: "active"` (idempotent — any concurrent writers all write the same value). Also writes a fixed-key activity feed entry `activityFeed/state_scheduled_to_active` to prevent duplicate "meetup is live" messages.
- **ActivityFeed** listens to both `child_added` AND `child_changed` — fixed-key entries trigger `child_changed` when multiple clients overwrite the same key.

### Backward Compatibility — Normalizers

Every component reads session/participant data through normalizers, never raw Firebase data:

```javascript
import { normalizeSession, normalizeParticipant } from '../utils/normalizers';
const session = normalizeSession(rawFirebaseData);
const participant = normalizeParticipant(rawParticipantData);
```

Key defaults applied by normalizers:
- Missing `state` → `"active"` (preserves legacy behavior)
- Missing `theme` → `{ color: "#0066CC", emoji: "📍", style: "classic" }`
- Missing `stops` → `[]` (coerced from Firebase object via `Object.values()` if needed)
- Missing `rsvpStatus` → `"going"` (legacy users intended to participate)
- Missing `visibility` → `"visible"`
- Missing `avatarId` → `null` (show initial letter instead of avatar)
- ISO string timestamps → epoch ms (via `new Date(val).getTime()`)
- Missing `headcount` → `null` (signals migration-on-read is needed)

### Headcount Transaction Pattern

`headcount` is a denormalized counter at the session root. Updated via `runTransaction()` whenever RSVP status or plus-ones change.

```javascript
import { computeHeadcountDelta } from '../utils/headcount';

const delta = computeHeadcountDelta({ oldStatus, newStatus, oldPlusOnes, newPlusOnes });
if (delta !== 0) {
  await runTransaction(headcountRef, (current) => (current || 0) + delta);
}
```

Six delta scenarios: new RSVP going (+1+plusOnes), going→maybe (-(1+oldPlusOnes)), maybe→going (+1+newPlusOnes), plus-ones change while going (newPlusOnes-oldPlusOnes), non-going status change (0), host kick (-(1+theirPlusOnes) if was going).

**Headcount migration-on-read**: When `normalizeSession` returns `headcount: null`, `useSession` runs a one-time computation from participants and writes the result via `runTransaction()`. Guarded by a `hasMigrated` ref.

### RSVP Flow & Maybe/Can't-Go Location Gate

- **Critical privacy rule**: `useGeolocation` checks `rsvpStatus === "going"` before calling any browser geolocation API. Maybe/Can't-Go participants are never prompted for location.
- Maybe/Can't-Go users in active sessions see "Change to Going to Share Location" instead of "I'm Leaving Now". Tapping it calls `update()` to change `rsvpStatus`, increments headcount via `runTransaction()`, then the location gate re-evaluates.
- All RSVP updates use `update()` NOT `set()` to preserve `customResponses`, `pollVote`, `myReactions`, `visibility`, and other fields across status changes.

### Location Tracking

- `navigator.geolocation.watchPosition()` with `enableHighAccuracy: true`
- Throttle Firebase writes to every 10 seconds (LOCATION_UPDATE_INTERVAL)
- Arrival detection runs on EVERY GPS ping (not throttled) for responsiveness
- Stale detection: `useEffect` interval checks `Date.now() - participant.lastUpdated`; dims markers after STALE_THRESHOLD (30s)
- **CRITICAL: All `useEffect` hooks MUST return cleanup functions** — `clearWatch` for geolocation, `clearInterval` for stale-check timers, `wakeLock.release()` for wake lock. Failing to do this causes memory leaks.

### ETA Calculation — Countdown Model

- Call Directions API ONCE when user taps "I'm Leaving Now"
- Calculate `expectedArrivalTime = Date.now() + (duration * 1000)`, store in Firebase
- Frontend ticks down `expectedArrivalTime - Date.now()` every second via `setInterval`
- Only re-call Directions API if: user is >500m off route (auto-detected), user taps "Recalculate ETA", or user switches travel mode
- Transit: uses scheduled `arrival_time` from API; displayed as fixed clock time not a countdown
- This reduces Directions API usage by ~90% vs continuous polling

### Off-Route Detection (geo.js)

```javascript
isOffRoute(currentPos, polylinePoints, thresholdMeters)
// Decodes routePolyline once per polyline change (useMemo in useGeolocation)
// Finds closest Haversine distance from currentPos to any polyline point
// Returns true if min distance > OFF_ROUTE_THRESHOLD_METERS (500m)
// Fires onOffRoute callback ONCE per polyline to prevent repeated API calls
```

### Host Recovery Flow

Host identity is tied to anonymous Firebase Auth UID in sessionStorage. If lost:
1. "Reclaim Host" link appears in Lobby (hidden if `hostSecretHash` is null)
2. User enters 4-digit PIN → client hashes via `crypto.subtle.digest('SHA-256', ...)` (async — show loading state)
3. Hash compared against stored `hostSecretHash`
4. On match: writes `permissions/coHosts/{newUid}: true` (self-add only)
5. User now has co-host privileges (edit logistics, trigger state changes, kick participants)
6. Rate limit: 3 wrong attempts → 60s lockout with countdown

### Session Management

- Session codes: 6-character alphanumeric (uppercase), generated client-side
- `hostId` in session root = creator's UID — immutable after creation (security rule: `!data.exists()`)
- Sessions auto-expire after 2 hours (`expiresAt`); client redirects to home on expiry
- Host ends session → sets `state: "completed"` → all clients stop location sharing
- `leaveSession()` removes the participant node from Firebase; headcount decremented if was "going"

### Participant Identity

- Firebase Anonymous Auth — `ensureAuth()` returns a stable UID (retries if initial sign-in failed)
- Participant ID = Firebase Auth UID (not random); stored in `sessionStorage` as `participant_{sessionId}`
- Refresh → same UID → reconnects as same participant
- `colorIndex` stored in Firebase + `colorPrefs` localStorage for consistency across sessions
- Optional `avatarId` (0–19) stored in Firebase participant node; renders native emoji avatar on marker + ETA panel

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

Full Social Edition rules. Key access control:
- **Blocked users**: denied all reads and writes at session level
- **`hostId`**: immutable after creation (`!data.exists()`)
- **`hostSecretHash`**: immutable after creation
- **`permissions` / `blockedUsers`**: host-only writes
- **`state`**: host/co-host any transition; ANY participant may write `scheduled → active` when `now > scheduledTime`
- **`logistics` / `poll` / `participants`** (for kick): host or co-host writes
- **`participants/{uid}`**: self-write only (host/co-host can write any node)
- **`pollVote`**: `!data.exists()` validation prevents double-voting; host/co-host can reset
- **`reactions` / `activityFeed`**: any non-blocked participant can write

## Current Build Status

**Social Edition Phases 1–3 + Rounds 3–6 complete. Phase 4 partially done.**

Original MVP + Tier 1 + Tier 2 + Tier 3:
- All live tracking features (arrival detection, ETA countdown, route polylines, travel modes, off-route recalculation)
- Full session management (nick, notes, arrival radius, history, favorites, expiry, recap)
- Calendar export (RFC 5545 `.ics` + Google Calendar URL), scheduled meetup countdown
- Real-time activity feed, session recap, status emojis, ETA bumps, pause/resume, SMS nudge

Social Edition Phases 1–3:
- **4-state machine** with `session.state` routing; ghost transition; normalizers; headcount transactions
- **Lobby.jsx** — themed invite, RSVP, guest list, logistics, polls, activity feed, kick, host recovery
- **Security rules** — full Social Edition access control (auth required, blocked users, immutable hostId)
- **CSS theme engine** — classic/fancy/digital styles; glassmorphism; `@supports` fallback
- **Visibility/hidden mode** — anonymous join, anonymized rendering, host sees real name
- **Enhanced SessionRecap** — group stats, highlight memory, clone meetup
- **Mobile polish** — safe-area-inset, 100dvh, 44px touch targets, overscroll-behavior

Round 3 enhancements:
- **Avatar system** — 20 inline SVG animal avatars (`Avatars.jsx`); `AvatarPicker` in JoinPrompt + Lobby RSVP; `AvatarIcon` on map markers + ETA panel; `avatarId` stored per participant; zero HTTP requests
- **Stops/waypoints** — up to 3 intermediate stops on Create (Places Autocomplete each); passed as Google Maps API waypoints; duration/distance summed across all legs; stop markers rendered on map
- **ETAPanel redesign** — 2-state bottom sheet (peek 160px / full 85vh); single scrollable view with NO tabs; DoorDash-inspired drag handle
- **Emoji backward compat** — `ICON_TO_EMOJI` maps in ParticipantMarker + ETAPanel handle legacy icon-name data; `EMOJI_TO_ICON` and `STATUS_ICONS` constants deleted
- **Auth hardening** — `ensureAuth()` retries anonymous sign-in; specific error messages for auth failure vs Firebase rejection
- **Client-side TTL cleanup** — `useTTLCleanup()` in `App.jsx`; 4 state-based rules (draft 7d, scheduled expiresAt+48h, active stale 24h, completed 30d)
- **Firebase array coercion** — normalizer handles RTDB storing arrays as objects (uses `Object.values()`)
- **Scrollable modals** — `.overlay` + `.prompt-card` now scroll when content exceeds viewport

Round 4 — UI Polish & Map Fixes:
- **Avatar selection indicator** — white border + `scale(1.1)` + white checkmark badge on selected; transparent border + background on unselected; no blue ring/glow
- **Map marker ring removed** — blue circular border stripped from `ParticipantMarker`; replaced with `filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))` for depth on dark map tiles
- **Action strip cleanup** — `.eta-icon-btn` changed to `background: transparent`; gray circles gone; 44px touch targets preserved; `:active` shows `rgba(255,255,255,0.1)` highlight
- **Map zoom-out fix (initial)** — `spatialFingerprint` useMemo in `Session.jsx` extracts only `[id, lat, lng, status]` per participant; `fitBounds` useEffect depends on fingerprint (not full `participants`), so non-spatial writes (statusEmoji, name, reactions) never trigger a re-fit; `userHasInteracted` + `isProgrammaticMove` refs gate auto-fit after manual pan; `isProgrammaticMove` resets via both `idle` event and 500ms setTimeout fallback

Round 5 — Bug Fixes & Polish:
- **Locale-aware distances** — `formatDistance()` in SessionRecap.jsx detects `navigator.language`; en-US/en-GB get miles (e.g. "2.4 mi"), all other locales get km
- **Arrival radius default 250m** — Create.jsx initializes `arrivalRadius` at 250; `ARRIVAL_RADIUS_OPTIONS` relabeled (`Default/🎯` at 250m, `Close/🏠` at 100m); `normalizeSession()` defaults missing `arrivalRadius` to 250; `ARRIVED_METERS` (100) unchanged as hardcoded legacy fallback
- **Recenter button visibility** — CSS `--panel-height` fallback corrected from 80px → 160px so button is never hidden behind the 160px peek panel on initial render
- **Emoji avatars** — SVG avatar system replaced with 20 native emoji characters (🐱 Cat → 👻 Ghost); `AvatarIcon` renders emoji `<span>` with no color prop applied; `AvatarPicker` shows plain emoji grid without per-slot color cycling; map markers with avatar use `.p-marker-dot-avatar` CSS class (radial-gradient white halo, `border: none !important`) instead of solid colored circle
- **Anonymous join UX** — toggle moved inline with name input as eye icon button; name auto-fills "Anonymous" and disables when active; helper text "Joining as anonymous guest" appears below; join button enabled without typing a name; `visibility: 'hidden'` written to Firebase on submit
- **Map zoom-out fix (GPS drift)** — trip-started auto-lock: new `useEffect` on `myParticipant?.status` sets `userHasInteracted=true` once trip begins, blocking GPS drift re-fits during active navigation; recenter handler sets `isProgrammaticMove=true` before clearing `userHasInteracted` to prevent ping-pong; 2s `lastFitBoundsTime` debounce guard added inside `fitMapBounds`

Round 6 — Bug Fixes & UX:
- **Stops discoverability** — "Add a stop" button moved outside `{destination && ...}` in Create.jsx so it is always visible; clicking without a destination focuses the search input (guides user to pick a destination first); stop rows still gated on `destination && stops.length > 0`
- **Map zoom-out on emoji/GPS jitter fix** — `spatialFingerprint` in Session.jsx now rounds lat/lng to 4 decimal places (~11m precision) before JSON-serialising; absorbs micro-GPS jitter (3–10m) that previously coincided with non-spatial writes (e.g. statusEmoji) and caused spurious `fitBounds` calls
- **Recenter button repositioned** — moved from `bottom: calc(var(--panel-height) + 16px)` (above ETA panel) to `top: 16px; right: 16px` (top-right of map area); removed `panel-at-full` hide rule and `bottom` CSS transition; no `--panel-height` dependency; desktop override updated to match

## Pending / Future Scope

**Phase 4 — Remaining:**
- "Clone This Meetup" button in Lobby (Recap clone already implemented) — reads session, strips participants, resets state to draft
- OG meta tags Cloud Function (intercept crawler requests to `/session/{id}`)

**Deferred / Enhancement Backlog:**
- Floating reaction bubbles above map markers (`statusEmoji` field already exists)
- Traffic-aware ETA (`departureTime: 'now'` in Directions API; verify billing tier impact first)
- PWA install prompt (`manifest.json`, `sw.js`, `beforeinstallprompt`)
- Low battery indicator (Chrome/Android only; `useBattery.js` hook)
- "Who's Nearby" toggle UI — deferred; conflicts with location-sharing privacy in scheduled state

**Tier 4 — Requires Auth/Backend:**
- User accounts (Firebase Auth)
- Push notifications (FCM + Cloud Functions)
- Dynamic OG images per session (Cloud Functions)
- Server-side groups (Firestore)
- Ride-share coordination (Routes API Matrix)
- Privacy zones

## Style Guidelines

- Mobile-first design — primarily used on phones
- Clean, minimal UI — the map is the hero (active state) / the lobby card is the hero (scheduled state)
- CSS custom properties for theming (light + dark); all colors via variables
- Accent color (`--theme-primary`, defaults to `#0066CC`) for CTAs
- Touch targets ≥ 44px everywhere
- Accessible: ARIA labels, ARIA live regions for toasts, keyboard navigation

## Important Constraints

- Do NOT add authentication for MVP (Anonymous Auth is already in use for security rules)
- Do NOT build full chat (text messages) yet — emoji status reactions first
- Do NOT add contact book integration
- Do NOT try to solve background location — acknowledge the limitation via UX banners
- Keep the dependency count minimal
- All API keys go in `.env`, never hardcoded
- Do NOT call Directions API more than once per trip start — use the countdown model
- **Always use `update()` not `set()` when changing a participant's RSVP status** — `set()` overwrites the entire node, destroying `customResponses`, `pollVote`, `myReactions`, etc.
- **Never read raw Firebase data in components** — always pipe through `normalizeSession()` / `normalizeParticipant()`
- **Firebase RTDB stores arrays as objects** — `[a, b]` becomes `{"0": a, "1": b}` on read. Any array field (e.g. `stops`) must be coerced back via `Object.values()` in the normalizer.
- **Use `ensureAuth()` not `whenAuthReady` for writes** — `whenAuthReady` is a one-shot promise that resolves to `null` on auth failure. `ensureAuth()` retries and guarantees a valid user.
- **Security rules require `auth != null`** — Anonymous Authentication MUST be enabled in Firebase Console for the app to work.
- **New participant fields go in `normalizeParticipant()`; new session fields go in `normalizeSession()`** — never mix session-level and participant-level data in the wrong normalizer.
- **Stale closures in `useCallback`** — if a callback references reactive data (like `session.stops`) that isn't in its deps array, use a `useRef` synced via `useEffect` (see `sessionStopsRef` pattern in Session.jsx).
