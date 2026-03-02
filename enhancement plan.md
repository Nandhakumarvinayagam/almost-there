# Almost There — Enhancement Implementation Plan

This plan incorporates the best strategies from two independent reviews. The core philosophy: **minimize API calls aggressively, use client-side math everywhere, and treat the Directions API as a "call once" operation.**

Each enhancement includes a detailed spec, the exact files to create/modify, and a Claude Code prompt you can paste directly.

> **NOTE:** The MVP prompts in `QUICKSTART.md` (Prompts 1-7) already build the countdown ETA model, `geo.js` (Haversine math), the "not-started" → "en-route" → "arrived" status flow, and the "Start Trip" gate. **All of Tier 1 is now complete.** The active starting point for new work is Tier 2.

---

## Current Status

| Enhancement | Status |
| ----------- | ------ |
| 1.1 Map Snapping Fix | ✅ Complete — `fitBounds` once on load, user controls map after |
| 1.2 Re-center Button | ✅ Complete — `RecenterButton.jsx` with fitBounds/follow-me toggle |
| 1.3 Start Trip Button | ✅ Complete — "I'm Leaving Now" bar, `STATUS.NOT_STARTED` gate |
| 1.4 Call Once + Countdown | ✅ Complete — `expectedArrivalTime` in Firebase, live ETAPanel tick |
| 1.5 Upgraded Visual Markers | ✅ Complete — `ParticipantMarker.jsx` with initials, color, stale/paused/arrived states |
| 1.6 Route Polylines | ✅ Complete — `RoutePolyline.jsx`, decoded from Firebase, color-matched |
| 1.7 Arrival Detection | ✅ Complete — `useGeolocation` fires at min(arrivalRadius×3, 1000)m (almost-there) and arrivalRadius (arrived) |
| 1.8 Arrival Order Prediction | ✅ Complete — ordinal badges, 60 s close-race detection, 5-section ETAPanel |
| 1.9 Dark Mode | ✅ Complete — CSS custom properties, `useColorScheme` hook, Google Maps dark styles |
| 1.10 Travel Mode Selection | ✅ Complete — 4-button selector (Drive/Bike/Transit/Walk), mid-trip switching, transit fixed clock time |
| 2.1 Quick Reactions | 🟡 Partial — Status emoji system built (☕ ⛽ 🅿️ 🚦 🏃 🛒); full floating bubble reactions not started |
| 2.2 OG Link Previews | ✅ Complete — OG + Twitter Card meta tags in index.html, gradient PNG with pin via Node.js script |
| 2.3 Mobile UX Polish | ✅ Complete — collapsible ETAPanel half-sheet, LocationPermissionPrompt (pre-ask/denied/unavailable), skeleton UI, route-phase button labels, map tile spinner |
| 3.1 Session History | ✅ Complete — `sessionHistory.js`, saved on end/expire, "Recent Meetups" on Home with "Start again" |
| 3.2 Favorite Destinations | ✅ Complete — `favorites.js`, star button in Create footer, quick-pick chips above search, prefill from history |
| 3.3 Traffic-Aware ETA | ⬜ Not started — add `departureTime: 'now'` to directions.js; verify billing tier impact first |
| 3.4 PWA Install | ⬜ Not started |
| UI Polish (Phase 1) | ✅ Complete — ghost button borders; emoji strip 28px + pill backgrounds; group note banner alignment; spectator link opacity 0.6; arrival radius hint contrast; header title first-letter capitalize; Activity badge margin/min-width |
| Header Refactor (Phase 2) | ✅ Complete — session code chip removed from header; Navigate + Share as top-level icon buttons; "Copy Session Code" in kebab; kebab: Copy Code / Edit Note / End Meetup / Leave (no Navigate duplicate); NoteIcon SVG on re-open buttons; header text truncates on narrow screens |
| Map & Panel UX (Phase 3) | ✅ Complete — current user z-index 10; Haversine label collision avoidance (no DOM measurements); "Location stale" badge tappable with info toast; map tile spinner pointer-events:none + text label; ETA panel tap-to-toggle + swipe; empty-session fitBounds → destination zoom 14 |
| F10 Calendar Export | ✅ Complete — `scheduledTime` datetime picker on Create (between notes and arrival radius); `expiresAt = scheduledTime + 2h`; `calendar.js` with RFC 5545 `.ics` (foldLine, escapeICS, VALARM) + Google Calendar URL (≤1800 chars); countdown banner in Session with calendar buttons + "Leave Early"; "won't update" disclaimer in ShareLink; `scheduledTime` persisted in `sessionHistory.js` |
| Scheduled Sessions (Home) | ✅ Complete — three states: "Scheduled · time" + Open / "In progress" + Open / "Start again" (clears scheduledTime); `getEntryState()` logic with `expiresAt` fallback |
| F11 Low Battery Indicator | ⬜ Not started — `useBattery.js` hook; writes `lowBattery` to Firebase participant; 🪫 in ETAPanel; Chrome/Android only, graceful no-op on Safari/Firefox |
| F13 Participant Count | ⬜ Not started — optional `expectedCount` on Create; live counter in Session; "Everyone's joined!" banner guarded by `hasCelebratedJoinCount` |

---

## TIER 1 — "Makes the MVP Actually Usable"

These are bugs and UX gaps that should be fixed before sharing the app with anyone. Total billing impact: $0.

---

### Enhancement 1.1 — Map Snapping Bug Fix

**The Problem:**
Every time a participant's location updates in Firebase, React re-renders the GoogleMap component and resets the center prop, snapping the user's view back to the destination. You cannot zoom into a participant's pin without the map jumping away.

**The Fix:**
Decouple the map viewport from Firebase state entirely.

**Implementation:**

1. In Map.jsx, use the onLoad callback from @react-google-maps/api to capture the Google Maps instance into a useRef.
2. Remove any center or zoom props that are dynamically tied to state. Set them only as defaultCenter and defaultZoom.
3. On initial session load, call mapRef.current.fitBounds(bounds) once to frame all participants + destination. After that, never programmatically move the camera.
4. Participant markers update their position via their own props — this does NOT trigger a map re-center.

**Files to modify:**

- src/components/Map.jsx — add useRef for map instance, use onLoad callback, remove dynamic center/zoom
- src/pages/Session.jsx — pass initial bounds calculation on first participant data load

**Claude Code Prompt:**

```
Fix the map snapping bug. The map currently re-centers every time Firebase
pushes a location update, which makes it impossible to zoom into a specific
participant.

The fix: In Map.jsx, capture the Google Maps instance via onLoad into a
useRef. Remove any dynamic center/zoom props from the GoogleMap component.
Only call mapRef.current.fitBounds() once on initial session load to frame
all participants and the destination. After that, let the user control the
map freely. Participant markers should update their position via their own
props without triggering any map viewport change.
```

---

### Enhancement 1.2 — Floating Re-center Button

**The Problem:**
Once auto-centering is removed, users need a way to see everyone again after panning away.

**The Fix:**
A floating circular button (crosshair icon) in the bottom-right corner of the map.

**Implementation:**

1. Create src/components/RecenterButton.jsx.
2. Position it absolute over the map, bottom-right, above the ETA panel.
3. On click: iterate all participants with status !== "not started", collect lat/lng plus destination, create LatLngBounds, call mapRef.current.fitBounds(bounds, { padding: 50 }).
4. Style: 44px circular button, white background, subtle shadow, crosshair SVG icon.

**Files to create:**

- src/components/RecenterButton.jsx

**Files to modify:**

- src/pages/Session.jsx — render RecenterButton, pass mapRef and participants

**Claude Code Prompt:**

```
Add a floating re-center button to the Session map. Create
src/components/RecenterButton.jsx — a 44px circular button with a
crosshair SVG icon, positioned absolute bottom-right above the ETA panel,
white background with subtle box-shadow.

On click, it should calculate a LatLngBounds that includes all active
participants (status !== "not started") plus the destination, then call
mapRef.current.fitBounds(bounds, { padding: 50 }). Pass mapRef and
participants data from Session.jsx.
```

---

### Enhancement 1.3 — "Start Trip" Button (Deferred Location + API Calls)

> **⚠️ SKIP if you built the MVP using current QUICKSTART.md prompts** — Prompts 3 and 4 already implement this.

**The Problem:**
Location sharing and Directions API calls start immediately when a user joins, even if they're still at home. This wastes API calls and shows a meaningless ETA.

**The Fix:**
Add a participant status flow: "not started" → "en-route" → "arrived".

**Implementation:**

1. When a user joins via JoinPrompt, write their participant record with status: "not started" and NO location data.
2. Show a prominent "I'm Leaving Now" button on the Session page.
3. Only when they tap "Start Trip":
   - Request navigator.geolocation permission
   - Start watchPosition
   - Call Directions API ONCE to get initial ETA and route polyline
   - Calculate expectedArrivalTime: Date.now() + (eta \* 1000)
   - Write location, eta, expectedArrivalTime, route polyline, and status "en-route" to Firebase
4. In the ETA panel, show "not started" participants in a "Waiting" section.

**Data model addition:**

```
expectedArrivalTime: timestamp
routePolyline: "encoded_string"
status: "not started" | "en-route" | "arrived"
```

**Files to modify:**

- src/hooks/useSession.js — update join logic to set status "not started"
- src/hooks/useGeolocation.js — don't start watching until explicitly triggered
- src/pages/Session.jsx — add Start Trip button, gate geolocation behind it
- src/components/ETAPanel.jsx — separate "Waiting" section
- src/utils/directions.js — return overview_polyline
- src/config/constants.js — add OFF_ROUTE_THRESHOLD_METERS (default: 500)

**Claude Code Prompt:**

```
Add a "Start Trip" flow. When a user joins a session, set their status to
"not started" with no location data. Show a prominent "I'm Leaving Now"
button on the Session page.

Only when they tap "Start Trip":
1. Request geolocation permission and start watchPosition
2. Call the Directions API ONCE to get initial ETA and the overview_polyline
3. Calculate expectedArrivalTime = Date.now() + (eta_seconds * 1000)
4. Write location, eta, expectedArrivalTime, routePolyline, and status
   "en-route" to Firebase

In the ETA panel, show "not started" participants in a "Waiting" section.
Do NOT start watchPosition or call Directions API until the user taps
Start Trip. Update useGeolocation.js to accept an enabled flag.
```

---

### Enhancement 1.4 — Smart ETA: Call Once + Countdown (Critical Cost Optimization)

> **⚠️ SKIP if you built the MVP using current QUICKSTART.md prompts** — Prompt 5 already implements this.

**The Problem:**
Polling the Directions API every 30 seconds burns through the 10,000 free monthly calls quickly.

**The Fix:**
Call Directions API once on "Start Trip", then use a client-side countdown. Only re-query if user goes significantly off-route.

**Implementation:**

1. On "Start Trip": call Directions API → get duration and overview_polyline → calculate expectedArrivalTime → store in Firebase.
2. Display ETA as live countdown: expectedArrivalTime - Date.now(), updating every second via setInterval.
3. On each geolocation update, run client-side off-route check:
   - Decode overview_polyline into lat/lng array
   - Find closest point on polyline to current position (Haversine)
   - If distance > OFF_ROUTE_THRESHOLD_METERS (500m), trigger ONE new Directions API call
   - Also provide manual "Recalculate ETA" button
4. Write updated expectedArrivalTime to Firebase on recalculation.

**Create src/utils/geo.js with:**

```javascript
function haversineDistance(pos1, pos2) {
  const R = 6371000;
  const dLat = toRad(pos2.lat - pos1.lat);
  const dLng = toRad(pos2.lng - pos1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pos1.lat)) *
      Math.cos(toRad(pos2.lat)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isOffRoute(currentPos, polylinePoints, thresholdMeters) {
  let minDistance = Infinity;
  for (const point of polylinePoints) {
    const d = haversineDistance(currentPos, point);
    if (d < minDistance) minDistance = d;
  }
  return minDistance > thresholdMeters;
}
```

**Files to create:**

- src/utils/geo.js — haversineDistance, isOffRoute, decodePolyline

**Files to modify:**

- src/utils/directions.js — return overview_polyline + expectedArrivalTime
- src/hooks/useGeolocation.js — add off-route detection
- src/components/ETAPanel.jsx — countdown timer instead of static ETA
- src/pages/Session.jsx — "Recalculate ETA" button
- src/config/constants.js — OFF_ROUTE_THRESHOLD_METERS, ETA_COUNTDOWN_INTERVAL_MS

**Claude Code Prompt:**

```
Implement the "call once + countdown" ETA strategy to minimize Directions
API costs.

1. Create src/utils/geo.js with: haversineDistance(pos1, pos2),
   decodePolyline(encoded), isOffRoute(currentPos, polylinePoints,
   thresholdMeters).

2. Update directions.js to return both the ETA duration and the
   overview_polyline encoded string.

3. When "Start Trip" is tapped, call Directions API ONCE. Calculate
   expectedArrivalTime = Date.now() + duration_ms. Store expectedArrivalTime
   and the encoded polyline in Firebase.

4. In ETAPanel, display a LIVE COUNTDOWN (expectedArrivalTime - Date.now())
   updating every second via setInterval. Show "12 min" format.

5. In useGeolocation, on each position update, decode the stored polyline
   and run isOffRoute with a 500m threshold. If off-route, auto-trigger ONE
   new Directions API call, recalculate expectedArrivalTime, and update
   Firebase. Add a "Recalculate ETA" manual button in Session.jsx.

6. Add OFF_ROUTE_THRESHOLD_METERS = 500 to constants.js.

All cleanup functions must be implemented — clearInterval for countdown,
clearWatch for geolocation.
```

---

### Enhancement 1.5 — Upgraded Visual Markers

**The Problem:**
Generic red Google Maps pins. Can't tell who is who.

**The Fix:**
Custom SVG markers with participant initials and assigned colors.

**Implementation:**

1. Color palette in constants.js (8 colors):
   '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B1FA2', '#E91E63'
2. Assign by participant join order.
3. Custom markers: 36px circle, assigned color fill, white initial letter, drop shadow.
4. Stale state (isStale): opacity 0.4, dashed border.
5. Arrived state: green ring + checkmark overlay.
6. Destination: distinct flag/target SVG with pulsing CSS animation.

**Files to modify:**

- src/components/ParticipantMarker.jsx
- src/config/constants.js — PARTICIPANT_COLORS array

**Claude Code Prompt:**

```
Upgrade the map markers. In ParticipantMarker.jsx, replace generic Google
pins with custom circular markers:
- 36px diameter circle filled with an assigned color
- White text showing first letter of participant's name (bold, centered)
- Subtle drop shadow
- Color from PARTICIPANT_COLORS in constants.js based on join order
- isStale: opacity 0.4, dashed border
- arrived: green ring, small checkmark

Destination marker: pulsing target/flag icon, larger than participant pins.
Use CSS keyframes for pulse. Add PARTICIPANT_COLORS (8 colors) to constants.js.
```

---

### Enhancement 1.6 — Route Polylines on Map (Free — Data Already Fetched)

**The Problem:**
No visual sense of where people are coming from.

**The Fix:**
Render each participant's route as a colored polyline using data already fetched from the Directions API.

**Implementation:**

1. overview_polyline is stored in Firebase per participant (from Enhancement 1.4).
2. Create src/components/RoutePolyline.jsx wrapping @react-google-maps/api Polyline.
3. Decode polyline, render with participant's color.
4. Style: 3px stroke, 0.6 opacity. Arrived = 0.2 opacity.

**Files to create:**

- src/components/RoutePolyline.jsx

**Files to modify:**

- src/pages/Session.jsx — render RoutePolyline for each participant

**Claude Code Prompt:**

```
Add route polylines to the map. Create src/components/RoutePolyline.jsx.

Each en-route participant has a routePolyline stored in Firebase. Decode
using decodePolyline() from utils/geo.js and render a Polyline from
@react-google-maps/api.

Style: 3px strokeWeight, 0.6 opacity, color matching participant's
PARTICIPANT_COLORS. When arrived: opacity 0.2. Only render for "en-route"
and "arrived" participants. No additional API calls needed.
```

---

### Enhancement 1.7 — Arrival Detection + "Almost There" Alert

**The Problem:**
No automatic notification when someone arrives. The app's namesake feature doesn't exist.

**The Fix:**
Client-side Haversine distance check. Two thresholds.

**Implementation:**

1. On each position update, calculate distance to destination.
2. Almost There (< 500m): write status "almost-there" to Firebase ONCE. Show animated badge.
3. Arrived (< 100m): write status "arrived". Stop watchPosition. Green checkmark.
4. If ALL arrived: "Everyone's here!" celebration state.

**Status flow:** "not started" → "en-route" → "almost-there" → "arrived"

**Files to modify:**

- src/hooks/useGeolocation.js — distance checks
- src/hooks/useSession.js — status writes
- src/components/ETAPanel.jsx — badges, sections, celebration state
- src/components/ParticipantMarker.jsx — visual states
- src/config/constants.js — ALMOST_THERE_METERS = 500, ARRIVED_METERS = 100

**Claude Code Prompt:**

```
Add arrival detection using client-side Haversine math (zero API calls).

In useGeolocation.js, on each position update, calculate distance to
destination using haversineDistance from utils/geo.js.

Two thresholds (add to constants.js):
- ALMOST_THERE_METERS = 500: Write status "almost-there" ONCE. Show
  animated badge in ETAPanel.
- ARRIVED_METERS = 100: Write status "arrived". Stop watchPosition.
  Green checkmark on marker.

Status flow: "not started" → "en-route" → "almost-there" → "arrived"
When ALL participants "arrived", show "Everyone's here!" celebration.
```

---

### Enhancement 1.8 — Arrival Order Prediction

**The Problem:**
ETAs listed but not ranked.

**The Fix:**
Sort by ETA, show ordinal badges.

**Implementation:**
Sort en-route participants by expectedArrivalTime. Show "1st", "2nd", "3rd" badges. If ETAs within 60s, show "Close race!". Arrived show actual time. Not-started listed last.

**Files to modify:**

- src/components/ETAPanel.jsx

**Claude Code Prompt:**

```
Add arrival order prediction to ETAPanel. Sort en-route participants by
expectedArrivalTime ascending. Show ordinal badges: "1st", "2nd", "3rd".

If two ETAs within 60 seconds, show "Close race!" indicator. Arrived
participants show actual time. Not-started listed last with no ranking.
```

---

### Enhancement 1.9 — Dark Mode

**The Problem:**
Blinding white UI at night.

**The Fix:**
System-preference dark mode for UI and Google Map.

**Implementation:**

1. CSS custom properties + @media (prefers-color-scheme: dark).
2. Dark map style JSON in src/config/mapStyles.js.
3. Detect and listen for changes via matchMedia.

**Files to create:**

- src/config/mapStyles.js

**Files to modify:**

- src/components/Map.jsx — apply style based on preference
- CSS files — dark mode variants

**Claude Code Prompt:**

```
Add dark mode. Create src/config/mapStyles.js with dark Google Maps style.

In Map.jsx, detect system preference via matchMedia and apply styles.
Listen for changes so it updates live.

For React UI, use CSS custom properties and @media (prefers-color-scheme:
dark). All components use variables instead of hardcoded colors.
Marker colors remain vivid in both modes.
```

---

### Enhancement 1.10 — Travel Mode Selection (Car / Bike / Transit / Walk)

> **Complexity: 2/10 | Billing impact: $0**

**The Problem:**
The app assumes everyone is driving. In cities, people take the train, bike, or walk. Without travel mode awareness, ETAs are wrong and route polylines are meaningless for non-drivers.

**The Fix:**
Let each user pick their commute mode before starting their trip. Pass it to the existing Directions API call (same cost — billing is per request, not per mode).

**Implementation:**

1. **UI:** Add a travel mode selector (4 tappable icons: 🚗 Car, 🚲 Bike, 🚇 Transit, 🚶 Walk) to the "Start Trip" flow. Show it after joining but before tapping "I'm Leaving Now." Default to DRIVING.

2. **Data model addition:**

```
participants/
  {participantId}/
    ...existing fields...
    travelMode: "DRIVING" | "BICYCLING" | "TRANSIT" | "WALKING"
```

3. **API call:** Update `directions.js` to accept the selected mode and pass it as the `travelMode` parameter in the Directions API request. Same single call, different parameter.

4. **ETA Panel:** Show a small icon (car/bike/train/walking figure) next to each participant's name so everyone knows how others are arriving.

5. **Transit-specific ETA display:** Transit ETAs are schedule-dependent — they depend on when the next bus/train departs, not just travel duration. For transit users:
   - Display as a fixed arrival time ("Arrives 7:42 PM") rather than a countdown ("12 min")
   - The Directions API returns `arrival_time` for transit routes — use this directly
   - If user misses a bus/train, the existing Haversine off-route detection will notice they haven't moved along the polyline and trigger a recalculation, automatically picking up the next departure

6. **Transit bonus data:** The Directions API response for transit includes line names ("Blue Line"), stop names ("Montgomery St Station"), and vehicle types. Display these in the ETA panel for transit users: "🚇 Blue Line → arrives 7:42 PM"

7. **Error handling:** Bicycling directions aren't available in all regions. If the API returns `ZERO_RESULTS` for a selected mode, show a friendly message: "Cycling directions aren't available for this route. Try another mode." Fall back gracefully.

8. **Polyline note:** Transit polylines include walking segments (to/from station) plus straight-line hops between stops. They look different from driving routes — this is expected behavior, not a bug.

**Files to modify:**

- src/utils/directions.js — accept and pass travelMode parameter
- src/hooks/useSession.js — store travelMode in Firebase participant record
- src/pages/Session.jsx — add mode selector UI to Start Trip flow
- src/components/ETAPanel.jsx — show mode icon + handle transit arrival time display
- src/components/ETAPanel.jsx — handle transit mode (show fixed clock time instead of countdown; `useCountdown.js` was not needed — countdown logic lives inline in ETAPanel)

**Claude Code Prompt:**

```
Add travel mode selection to the app.

1. In the "Start Trip" flow on Session.jsx, add a row of 4 tappable
   icon buttons before the "I'm Leaving Now" button:
   - 🚗 Drive (default, selected state)
   - 🚲 Bike
   - 🚇 Transit
   - 🚶 Walk
   Style as pill buttons, 44px touch targets, highlight the selected one.

2. Save the selected mode to the participant's Firebase record as
   travelMode: "DRIVING" | "BICYCLING" | "TRANSIT" | "WALKING".

3. Update directions.js to accept a travelMode parameter and pass it
   in the Directions API request.

4. In ETAPanel.jsx, show a small icon (car/bike/bus/walking) next to
   each participant's name based on their travelMode.

5. For TRANSIT users specifically:
   - Extract arrival_time from the Directions API transit response
   - Display as a fixed time ("Arrives 7:42 PM") instead of a countdown
   - Show transit details if available: line name + stop name
     (e.g., "🚇 Blue Line → Montgomery St")

6. Handle ZERO_RESULTS gracefully — if the API returns no route for
   the selected mode (common for BICYCLING in some regions), show
   a message: "Directions not available for this mode. Try another."
   and let the user re-select.

7. Update useCountdown.js to handle two display modes:
   - Countdown mode (DRIVING/BICYCLING/WALKING): "12 min"
   - Fixed arrival mode (TRANSIT): "Arrives 7:42 PM"
```

---

## TIER 2 — "Makes People Want to Share It"

Small Firebase cost increase from reaction writes.

---

### Enhancement 2.1 — Quick Status Reactions

**Status:** 🟡 Partially done.

**What's built:** The status emoji system (`statusEmoji` field in Firebase, emoji picker in ETAPanel, badge below participant marker dot) covers the core use case. Six presets: ☕ Coffee, ⛽ Gas, 🅿️ Parking, 🚦 Traffic, 🏃 Running Late, 🛒 Quick Errand. Stored in Firebase, cleared on arrival.

**What's remaining:** Floating reaction bubbles above map markers (the more visual/social aspect). These feel ephemeral and tie more to the "chat" vision.

**Remaining Implementation:**

Ephemeral reactions: write to `sessions/{id}/events/` with `type: "reaction"` and `expiresAt (+ 60s)`. Show as floating bubble above the sender's marker. Auto-hide client-side after 60s.

**Files to create:**

- `src/components/ReactionBubble.jsx` — floating bubble above marker with emoji + fade-in/out

**Files to modify:**

- `src/pages/Session.jsx` — render ReactionBubble for active reactions
- `src/hooks/useSession.js` — filter `events/` for active reaction type; client-side expiry check
- `src/config/constants.js` — `REACTION_TTL_MS = 60000`

**Claude Code Prompt:**

```
The status emoji picker in ETAPanel (☕ ⛽ 🅿️ etc.) is already built.
Now add floating reaction bubbles above map markers.

When a participant has an active statusEmoji, render a ReactionBubble.jsx
OverlayView above their ParticipantMarker. The bubble should:
- Show the emoji in a small rounded pill (white bg, subtle shadow)
- Fade in on appear, fade out when cleared
- Be positioned ~50px above the marker dot

Use the existing statusEmoji field from Firebase — no new data model needed.
Clear the bubble when statusEmoji is null/undefined (arrival clears it).
```

---

### Enhancement 2.2 — OG Link Previews (Zero Cost)

**The Problem:**
Bare URL when sharing via messaging apps.

**The Fix:**
Static Open Graph meta tags in index.html.

**Files to modify:**

- index.html — OG meta tags
- public/ — og-image.png (1200x630px)

**Claude Code Prompt:**

```
Add Open Graph meta tags to index.html: og:title, og:description, og:image
pointing to /og-image.png, og:type. Add Twitter card tags.

Create a simple og-image.png (1200x630px) in public/ with app name and
map pin icon on a gradient background.
```

---

### Enhancement 2.3 — Mobile UX Polish

**The Problem:**
ETA panel too large, confusing permission states, no loading indicators.

**The Fix:**
Collapsible half-sheet, permission prompt, loading skeletons.

**Files to create:**

- src/components/LocationPermissionPrompt.jsx

**Files to modify:**

- src/components/ETAPanel.jsx — collapsible
- src/pages/Session.jsx — loading states

**Claude Code Prompt:**

```
Polish mobile UX:

1. ETAPanel as collapsible half-sheet. Collapsed = handle + summary.
   Expand on tap/swipe. CSS transform + touch events.

2. LocationPermissionPrompt.jsx with pre-ask, denied, unavailable states.

3. Loading states: skeleton UI, "Calculating route...", map spinner.

4. All buttons minimum 44px touch targets.
```

---

## TIER 3 — "Makes It Feel Like a Real Product"

Mostly client-side persistence.

---

### Enhancement 3.1 — Session History (localStorage)

**Billing impact:** Zero.

**Files to create:**

- src/utils/sessionHistory.js

**Files to modify:**

- src/pages/Home.jsx — Recent Meetups section
- src/pages/Session.jsx — save on end/expire via useEffect (not useSession.js — Firebase session data is read directly from the session snapshot)

**Claude Code Prompt:**

```
Add session history via localStorage. Create src/utils/sessionHistory.js
with saveSession, getHistory, clearHistory.

Save on session end: sessionId, destination, date, participants, wasHost.
Cap at 20. Show "Recent Meetups" on Home.jsx with "Start again" button.
```

---

### Enhancement 3.2 — Favorite Destinations (localStorage)

**Billing impact:** Zero.

**Files to create:**

- src/utils/favorites.js

**Files to modify:**

- src/pages/Create.jsx — favorites chips, save button

**Claude Code Prompt:**

```
Add favorites via localStorage. Create src/utils/favorites.js.

On Create.jsx, "Save as favorite" star button after picking destination.
Show favorites as quick-pick chips above search bar. Cap at 10.
```

---

### Enhancement 3.3 — Traffic-Aware ETA (Verify Billing!)

**Warning:** May reclassify from Essentials (10k free) to Pro (5k free) tier.

**Files to modify:**

- src/utils/directions.js

**Claude Code Prompt:**

```
Add traffic-aware ETA. In directions.js, add departureTime: 'now'.
Put behind feature flag ENABLE_TRAFFIC_AWARE_ETA in constants.js.
Easy to toggle off if billing changes.
```

---

### Enhancement 3.4 — PWA Install Prompt

**Critical:** Do NOT cache Google Maps tiles in service worker.

**Files to create:**

- public/manifest.json
- public/sw.js
- public/icons/

**Files to modify:**

- index.html
- src/App.jsx — beforeinstallprompt listener

**Claude Code Prompt:**

```
Add PWA support. Create manifest.json, sw.js (cache app shell ONLY,
NOT map tiles or Firebase). Listen for beforeinstallprompt in App.jsx,
show dismissible install banner. Create app icons 192px and 512px.
```

---

## TIER 4 — Future Reference (Requires Auth/Backend)

| Feature                 | Requirement           | Cost                             |
| ----------------------- | --------------------- | -------------------------------- |
| User accounts           | Firebase Auth         | Free < 50k MAU                   |
| Push notifications      | FCM + Cloud Functions | Blaze plan (2M free invocations) |
| Server-side groups      | Firestore             | $0.18/100k reads                 |
| Calendar integration    | Google Calendar API   | Free tier                        |
| Dynamic OG images       | Cloud Functions       | Blaze plan                       |
| Ride-share coordination | Routes API Matrix     | Enterprise, 1k free/mo           |
| Privacy zones           | Client + server       | Minimal                          |

---

## Build Sequence Summary

| Order | Enhancement            | Tier | Billing   | API Calls Saved      | Done |
| ----- | ---------------------- | ---- | --------- | -------------------- | ---- |
| 1     | Map snapping fix       | T1   | $0        | —                    | ✅   |
| 2     | Re-center button       | T1   | $0        | —                    | ✅   |
| 3     | Start Trip button      | T1   | $0        | Saves idle calls     | ✅   |
| 4     | Call once + countdown  | T1   | $0        | ~30x reduction       | ✅   |
| 5     | Custom markers         | T1   | $0        | —                    | ✅   |
| 6     | Route polylines        | T1   | $0        | Data already fetched | ✅   |
| 7     | Arrival + Almost There | T1   | $0        | Client-side math     | ✅   |
| 8     | Arrival order          | T1   | $0        | Client-side sort     | ✅   |
| 9     | Dark mode              | T1   | $0        | —                    | ✅   |
| 10    | Travel mode selection  | T1   | $0        | Same API call        | ✅   |
| 11    | Quick reactions        | T2   | ~$0       | Tiny writes          | 🟡 Partial (status emoji done; floating bubbles remaining) |
| 12    | OG link previews       | T2   | $0        | —                    | ✅   |
| 13    | Mobile UX polish       | T2   | $0        | —                    | ✅   |
| 14    | Session history        | T3   | $0        | localStorage         | ✅   |
| 15    | Favorites              | T3   | $0        | localStorage         | ✅   |
| 16    | Traffic-aware ETA      | T3   | ⚠️ Verify | May change tier      | ⬜   |
| 17    | PWA install            | T3   | $0        | Don't cache tiles    | ⬜   |
| 18    | Calendar export        | UF10 | $0        | Client-side only     | ✅   |
| 19    | Participant count      | UF13 | $0        | Client-side only     | ⬜   |
| 20    | Low battery indicator  | UF11 | $0        | Battery API (Chrome) | ⬜   |

---

## Implemented Extras (not originally in the plan)

These features were built as part of the core MVP or enhancement work and are fully shipped.

### Session Creation Extras

| Feature | Where | Notes |
| ------- | ----- | ----- |
| Meetup nickname | `Create.jsx` → Firebase session root | Optional display name for the meetup (max 40 chars); shown in header and OG share text |
| Group note | `Create.jsx` → Firebase session root | Optional 200-char note for the group; host can edit in-session; auto-collapses on mobile after 5s |
| Configurable arrival radius | `Create.jsx` → `session.arrivalRadius` | Four options: 50m / 100m / 250m / 500m; sets both "arrived" and "almost-there" thresholds |

### Map & Navigation Extras

| Feature | Where | Notes |
| ------- | ----- | ----- |
| Screen Wake Lock | `Session.jsx` | Acquires `navigator.wakeLock` while session active; re-acquires on `visibilitychange`; releases on unmount/end/expire |
| Destination marker redesign | `DestinationMarker.jsx` | 📍 emoji OverlayView; tip anchored exactly to coordinate |
| Navigation deep-link | `Session.jsx` + `utils/navigation.js` | Header "Navigate" button; Apple Maps scheme on iOS, Google Maps URL elsewhere; respects travel mode |
| Follow-me mode | `RecenterButton.jsx` + `Session.jsx` | Toggle between overview (fitBounds all active) and follow-me (pan to current user on every update) |
| Map tile loading spinner | `Session.jsx` | Overlay spinner while Google Maps renders its first tile set (`onTilesLoaded` callback) |
| Pre-trip background geolocation | `Session.jsx` | Fetches current location before Start Trip to enable the button; shows "Getting your location…" phase |

### Participant & Trip Extras

| Feature | Where | Notes |
| ------- | ----- | ----- |
| Pause/Resume location sharing | `ETAPanel.jsx` + `useSession.js` | Voluntary ghost mode; status switches to "paused"; marker shows ⏸ icon; ETA panel has its own Paused section |
| Travel mode switch mid-trip | `ETAPanel.jsx` + `useSession.js` | 60s cooldown between switches (`MODE_SWITCH_COOLDOWN_MS`); triggers new Directions API call; resets bump state |
| ETA Bump | `ETAPanel.jsx` + `useSession.js` | +5 or +10 min per tap; max 3 bumps (`MAX_ETA_BUMPS`); persisted as `manualDelayMs` in Firebase; resets on recalculate |
| Quick status emoji | `ETAPanel.jsx` + `useSession.js` | Six presets (☕ ⛽ 🅿️ 🚦 🏃 🛒); stored as `statusEmoji` in Firebase; badge shown below marker dot; cleared on arrival |
| Manual "I'm Here" arrival | `ETAPanel.jsx` + `useSession.js` | Shown when within 2× arrivalRadius; calls `markArrivedManually()`; clears polyline |
| Keep Visible toggle | `ETAPanel.jsx` + `useSession.js` | Arrived pins auto-hide after 5 min; toggle sets `keepVisible: true` in Firebase to override |
| SMS nudge | `ETAPanel.jsx` | Triggers `sms:` deep link pre-filled with participant name; 60s per-participant cooldown; no API cost |
| Color preference persistence | `utils/colorPrefs.js` | LRU localStorage cache (max 20) maps participant name → colorIndex; same name gets same color across sessions |

### Activity & Social Extras

| Feature | Where | Notes |
| ------- | ----- | ----- |
| Real-time activity feed | `ETAPanel.jsx` + `useSession.js` (`logEvent`) | `onChildAdded` listener on `sessions/{id}/events/`; events: joined, trip_started, mode_switched, almost_there, arrived, left; capped at 50 events |
| Session Recap overlay | `SessionRecap.jsx` + `Session.jsx` | Shown after host ends meetup; podium (🥇 first arrived, 🐢 most delayed); trip duration table per participant |
| Share ETA per participant | `ETAPanel.jsx` | Copies "Alice will arrive at 9:26 AM" text to clipboard |
| "Everyone's here!" celebration | `Session.jsx` / `index.css` | Green slide-down banner when all participants have arrived; haptic double-buzz on Android |

### UI/UX Extras

| Feature | Where | Notes |
| ------- | ----- | ----- |
| Session code chip in header | `Session.jsx` | Tap-to-copy 6-char code; top of header next to Share button |
| Address copy-on-click | `Session.jsx` | Tapping destination name in header copies the full address; haptic confirmation |
| Kebab menu | `Session.jsx` | ⋮ button: Share Link (mobile), End Meetup (host only), Leave Meetup |
| ℹ️ re-open notes button | `Session.jsx` | Floating button to restore group note banner after auto-collapse |
| Offline detection banner | `Session.jsx` | `window online/offline` events; shows banner; pauses location writes |
| Firebase connection monitoring | `Session.jsx` | `.info/connected` listener with 3s grace period; "Back online" flash banner for 2s on reconnect |
| Navigation tip banner | `Session.jsx` | "Keep Almost There open to share your location" — dismissible once per session |
| Route-phase button labels | `Session.jsx` | Three phases via `startingPhase` state: "Getting your location…" → "Calculating route…" → "I'm Leaving Now" |
| Session skeleton loader | `Session.jsx` / `index.css` | Shimmer-animated placeholder matching real layout; shown while Maps SDK + Firebase load |
| Pre-ask location permission gate | `Session.jsx` + `LocationPermissionPrompt.jsx` | Checks `navigator.permissions.query` before calling `getCurrentPosition`; context dialog before native prompt |
| Haptic feedback | `utils/haptic.js` | `navigator.vibrate` on arrivals (double-buzz), button confirmations; gracefully no-ops on iOS/Safari |
| OG image generator script | `scripts/generate-og-image.js` | Pure Node.js PNG encoder (no external deps); run `node scripts/generate-og-image.js` to regenerate |
| History "Start again" prefill | `Create.jsx` + `Home.jsx` | Router state carries destination; search input pre-filled via ref after `isLoaded`; geolocation auto-center skipped |

---

## Usability Backlog (Zero Cost, Client-Side Only)

These three features were planned but not yet implemented. All are zero-cost, client-side only, and backward-compatible (all new Firebase fields are optional).

---

### Usability F10 — Calendar Export (.ics + Google Calendar)

**Status: ✅ Complete**

**Complexity: 3/10 | Billing impact: $0**

**Implemented in:**
- `src/utils/calendar.js` — `generateGoogleCalendarURL()` (URL ≤1800 chars, truncates description if needed) and `generateICSBlob()` (RFC 5545, line-folded at 75 octets, `foldLine()` + `escapeICS()` helpers, VALARM -PT30M reminder)
- `src/pages/Create.jsx` — `<input type="datetime-local">` labeled "Schedule a time (optional)"; `expiresAt = scheduledTime + 2h` when set
- `src/hooks/useSession.js` — `scheduledTime` included in session creation
- `src/pages/Session.jsx` — countdown banner; swaps to "Time to head out! 🚀" at zero; "Leave Early" reveals pre-trip flow; haptic fires exactly once (ref-guarded); countdown parent never remounts on expiry (className swap)
- `src/components/ShareLink.jsx` — "Add to Google Calendar" + "Download .ics" buttons only when `scheduledTime` exists; "Calendar events won't update if meetup details change" disclaimer
- `src/utils/sessionHistory.js` — `scheduledTime` persisted in history entries
- `src/pages/Home.jsx` — three states: "Scheduled · time" + Open / "In progress" + Open / "Start again" (clears scheduledTime)

**Data model addition:** `sessions/{id}/scheduledTime: 1709145600000` (optional ms timestamp)

---

### Usability F11 — Low Battery Indicator

**Complexity: 2/10 | Billing impact: $0**

**Files to create:**
- `src/hooks/useBattery.js` — `navigator.getBattery()` wrapper; `isLow = level < 0.15 && !charging`; recovery at `level >= 0.20 || charging` (hysteresis); listens to `levelchange` and `chargingchange` events; returns `{ supported: bool, isLow: bool }`; cleanup removes event listeners

**Files to modify:**
- `src/pages/Session.jsx` — integrate `useBattery()`; write `lowBattery: true/false` to current participant Firebase node on `isLow` change (useEffect with `isLow` dep)
- `src/components/ETAPanel.jsx` — show 🪫 icon next to participant name when `participant.lowBattery === true`

**Data model addition:** `participants/{id}/lowBattery: true | false` (optional)

**Critical:** Must be a complete no-op on Safari and Firefox — `navigator.getBattery` will be undefined. No errors, no warnings, no UI elements shown. Return `{ supported: false, isLow: false }` when API unavailable.

---

### Usability F13 — Participant Count / "Waiting for Others"

**Complexity: 2/10 | Billing impact: $0**

**Files to modify:**
- `src/pages/Create.jsx` — optional number input or stepper labeled "Expected guests (optional)"; range 2–20; not required
- `src/hooks/useSession.js` — include `expectedCount` (integer) in session creation; only write if set
- `src/pages/Session.jsx` — live counter near session header: "2 of 5 joined" if `expectedCount` set, "2 joined" if not; "Everyone's joined! 🎉" banner that auto-dismisses after 3 s
- `src/components/ETAPanel.jsx` — show count in collapsed panel summary: "3 of 5 • Next: 8 min"

**Data model addition:** `sessions/{id}/expectedCount: 5` (optional integer)

**Critical:** Guard the "Everyone's joined!" banner with a `hasCelebratedJoinCount` boolean in React state (default `false`). Without this guard, the banner re-fires if someone uses "Leave Meetup" then rejoins, pushing the count back over the threshold.

---

## Pre-Enhancement Checklist

- [ ] Upgrade Firebase to Blaze plan (free until limits exceeded)
- [ ] Set $5 budget alert in Google Cloud Console
- [ ] Set $5 budget alert in Firebase Console
- [ ] Verify Directions API enabled and working
- [ ] Run npm run build && firebase deploy to confirm current state

## Directions API Migration Note

Directions API is now Legacy. Plan to migrate to Routes API (Compute Routes) in a future iteration — similar structure, better pricing.
