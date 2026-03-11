# Multi-Stop Waypoints — Design Document

## Overview

Add the ability for hosts to define intermediate stops (waypoints) before the final destination. Participants navigate through each stop in order, with per-leg ETAs and progress tracking.

**Scope**: Pre-trip setup + active session tracking. Mid-trip stop additions are a stretch goal.

---

## 1. Data Model

### Session-Level Changes

```
sessions/{sessionId}/
  destination: { lat, lng, name, address }        # UNCHANGED — final destination (backward compat)
  waypoints: [                                     # NEW — ordered intermediate stops
    {
      id: "wp_0",
      lat: 37.7749,
      lng: -122.4194,
      name: "Blue Bottle Coffee",
      address: "66 Mint St, San Francisco, CA",
      order: 0
    },
    {
      id: "wp_1",
      lat: 37.7849,
      lng: -122.4094,
      name: "Union Square",
      address: "333 Post St, San Francisco, CA",
      order: 1
    }
  ]
```

### Participant-Level Changes

```
sessions/{sessionId}/participants/{pid}/
  # Existing fields unchanged (location, status, eta, routePolyline, etc.)

  nextWaypointIndex: 0              # NEW — index into waypoints array (0 = first stop)
  completedWaypoints: ["wp_0"]      # NEW — array of wp_ids already visited
  waypointArrivals: {               # NEW — timestamp of arrival at each waypoint
    "wp_0": 1709900000000
  }
```

### Key Design Decisions

- **`waypoints` is an ordered array**, not a map. Array index = visit order. The `order` field is redundant but useful for drag-to-reorder UX and Firebase partial updates.
- **`destination` is kept separate** from waypoints for backward compatibility. Sessions without `waypoints` work exactly as before.
- **Max 5 waypoints**. Google Directions API supports up to 25, but UX quality degrades past 5 stops. Enforced client-side.
- **`nextWaypointIndex`** tracks per-participant progress. When it equals `waypoints.length`, the participant is navigating to the final destination.

---

## 2. Directions API Changes

### `getETAWithRoute` Enhancement

The existing function takes `(origin, destination, travelMode)`. Add an optional `waypoints` parameter:

```javascript
// src/utils/directions.js

export function getETAWithRoute(origin, destination, travelMode = "DRIVING", waypoints = []) {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DirectionsService();

    const request = {
      origin: new google.maps.LatLng(origin.lat, origin.lng),
      destination: new google.maps.LatLng(destination.lat, destination.lng),
      travelMode: google.maps.TravelMode[travelMode],
    };

    // Add waypoints if present
    if (waypoints.length > 0) {
      request.waypoints = waypoints.map(wp => ({
        location: new google.maps.LatLng(wp.lat, wp.lng),
        stopover: true,
      }));
      request.optimizeWaypoints = false; // preserve user's order
    }

    service.route(request, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK) {
        const route = result.routes[0];
        const legs = route.legs; // N+1 legs for N waypoints

        // Total trip duration (all legs)
        const totalEta = legs.reduce((sum, leg) => sum + leg.duration.value, 0);

        // Per-leg durations and distances
        const legDetails = legs.map((leg, i) => ({
          index: i,
          eta: leg.duration.value,           // seconds
          distance: leg.distance?.text,
          distanceMeters: leg.distance?.value,
          startAddress: leg.start_address,
          endAddress: leg.end_address,
        }));

        // Transit info from first transit leg (existing behavior)
        let transitArrivalTime = null;
        let transitInfo = null;
        if (travelMode === "TRANSIT") {
          const lastLeg = legs[legs.length - 1];
          transitArrivalTime = lastLeg.arrival_time
            ? lastLeg.arrival_time.value.getTime()
            : null;
          const step = lastLeg.steps?.find(s => s.travel_mode === "TRANSIT");
          if (step?.transit) {
            transitInfo = {
              line: step.transit.line?.short_name || step.transit.line?.name || null,
              vehicleType: step.transit.vehicle?.type || null,
              departureStop: step.transit.departure_stop?.name || null,
            };
          }
        }

        resolve({
          eta: totalEta,                          // total trip seconds
          routePolyline: route.overview_polyline, // covers ALL legs
          routeDistance: legs[legs.length - 1].distance?.text ?? null,
          routeDistanceMeters: legs.reduce((sum, l) => sum + (l.distance?.value ?? 0), 0),
          transitArrivalTime,
          transitInfo,
          legDetails,                             // NEW — per-leg breakdown
        });
      } else {
        // ... existing error handling
      }
    });
  });
}
```

### API Cost Impact

- **Zero additional cost**. Waypoints are included in the same Directions API call. Google bills per request, not per waypoint.
- Recalculation triggers (off-route, mode switch) also include waypoints automatically.
- The "call once, countdown locally" model is preserved.

---

## 3. Arrival Detection Changes

### Current Behavior (`useGeolocation.js`)

The hook checks distance from current position to `session.destination` on every GPS ping. When within `arrivalRadius`, it triggers arrival.

### New Behavior

```
On each GPS ping:
  1. Get participant's nextWaypointIndex
  2. If nextWaypointIndex < waypoints.length:
     → Check distance to waypoints[nextWaypointIndex]
     → If within arrivalRadius:
        a. Write waypointArrivals/{wp_id}: Date.now()
        b. Push to completedWaypoints array
        c. Increment nextWaypointIndex
        d. Log activity: "Arrived at [waypoint name]"
        e. Show toast: "Arrived at [waypoint name]! Next stop: [next name]"
        f. Haptic feedback
  3. If nextWaypointIndex === waypoints.length:
     → Check distance to session.destination (existing behavior)
     → Standard arrival flow
```

### Edge Cases

- **Skip detection**: If a participant passes through a waypoint's radius without stopping (GPS sampling misses it), don't force them to backtrack. Instead, check if they're closer to a LATER waypoint. If within radius of waypoint N+2 but never triggered N+1, auto-complete N+1 with a "skipped" flag.
- **Arrival radius**: Use session's `arrivalRadius` for all waypoints (same threshold as final destination). Could be per-waypoint in a future iteration.
- **No ETA recalculation on waypoint arrival**: The overall route polyline covers all legs. Only recalculate if the participant is off-route.

---

## 4. ETA Model

### Current Model
- `expectedArrivalTime` = `Date.now() + totalDuration` at trip start
- Frontend counts down `expectedArrivalTime - Date.now()` every second

### New Model
- `expectedArrivalTime` = same (total trip to final destination) — **unchanged for backward compat**
- **NEW**: `nextWaypointETA` computed from `legDetails`:
  ```
  nextWaypointETA = sum of remaining leg durations up to nextWaypointIndex
  ```
  Stored in Firebase per participant. Updated on trip start and waypoint arrival.

### Display in ETAPanel

For participants with waypoints:
```
┌──────────────────────────────────────┐
│ ☕ Nandha                    12 min  │  ← ETA to next waypoint
│ Next: Blue Bottle Coffee  (Stop 1/3)│
│ Final: Times Square          45 min │  ← ETA to final destination
│ ● ◐ ○ ○                            │  ← progress dots
└──────────────────────────────────────┘
```

For participants without waypoints (backward compat):
```
┌──────────────────────────────────────┐
│ ☕ Nandha                    45 min  │  ← same as today
└──────────────────────────────────────┘
```

---

## 5. UI Changes

### 5.1 Create.jsx — Adding Stops

**Location**: Below the destination picker, above the nickname input.

```
┌─────────────────────────────────────────┐
│ 📍 Destination: Times Square            │
│                                         │
│ Stops along the way:                    │
│ ┌─────────────────────────────────────┐ │
│ │ 1. ☕ Blue Bottle Coffee    [⋮] [✕] │ │
│ │ 2. 🏛 Union Square          [⋮] [✕] │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [+ Add a stop]                          │
│                                         │
│ Meetup nickname (optional)              │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Behavior**:
- "Add a stop" opens a Places Autocomplete search (same component as destination picker)
- Each waypoint shows: number + name + drag handle (or up/down arrows) + remove button
- Drag-to-reorder updates the `order` field
- Max 5 stops. After 5, the "Add a stop" button is hidden
- Waypoints are stored in session creation payload alongside `destination`

**Implementation notes**:
- Reuse the existing `PlacesAutocomplete` pattern from the destination picker
- Store waypoints in local state as an array; write to Firebase on "Start Meetup"
- The waypoint list is a simple `<ul>` with `draggable` items or up/down arrow buttons for mobile accessibility

### 5.2 Session.jsx — Map Markers

**Waypoint markers**: Numbered circles (1, 2, 3...) using the same `OverlayView` pattern as `DestinationMarker`.

```
Upcoming waypoints:   ①  ②  ③   (blue circle, white number)
Visited waypoints:    ✓₁ ✓₂      (green circle, white checkmark)
Final destination:    📍          (existing DestinationMarker)
```

**Route polyline**: The Directions API returns a single `overview_polyline` covering all legs. This is already rendered by `RoutePolyline.jsx` — no change needed. The polyline naturally passes through all waypoints.

**Per-participant progress**: Each participant's marker has a small badge showing their current stop number (e.g., "→2" meaning heading to stop 2).

### 5.3 ETAPanel.jsx — Stop Progress

Per-participant row enhancement:

```
┌──────────────────────────────────────────┐
│ 🟢 Nandha                       12 min  │
│    → Stop 1: Blue Bottle Coffee          │
│    ● ─── ◐ ─── ○ ─── ○ ─── 📍          │
│                                          │
│ 🟢 Sarah                        28 min  │
│    → Stop 2: Union Square                │
│    ● ─── ● ─── ◐ ─── ○ ─── 📍          │
└──────────────────────────────────────────┘
```

- `●` = completed stop (green)
- `◐` = current stop (blue, pulsing)
- `○` = upcoming stop (gray)
- `📍` = final destination

**On waypoint arrival**: Brief celebration toast ("Nandha arrived at Blue Bottle Coffee!") + activity feed entry.

### 5.4 Lobby.jsx — Waypoint Display

In the scheduled Lobby view, show the stop list below the destination:

```
┌─────────────────────────────────────┐
│         🍕                          │
│    Pizza Night                      │
│                                     │
│  📍 Joe's Pizza, NYC               │
│                                     │
│  Stops along the way:              │
│  1. Blue Bottle Coffee             │
│  2. Union Square                   │
│                                     │
│  🗓 Saturday, 7:00 PM              │
└─────────────────────────────────────┘
```

---

## 6. Mid-Trip Stop Addition (Stretch Goal)

Allow the host to add a new stop DURING an active session.

### Flow

1. Host taps a "+" button (new FAB or kebab menu option: "Add a Stop")
2. Places Autocomplete opens
3. Host selects location → writes new waypoint to `session.waypoints`
4. All participants' Firebase listeners detect the `waypoints` change
5. Each participant's `useGeolocation` hook recalculates:
   - If the new waypoint's `order` is BEFORE their `nextWaypointIndex`: ignore (already passed it)
   - If the new waypoint's `order` is AT or AFTER their `nextWaypointIndex`: shift their index to account for the insertion
6. Route is NOT automatically recalculated. A "Route updated" banner appears with a "Recalculate" button.

### Complexity Considerations

- **Index shifting**: Inserting a waypoint at position 1 when a participant is heading to position 2 means their target changes. This requires careful index management.
- **Race conditions**: Multiple participants writing waypoint arrivals while the host inserts a new waypoint. Using Firebase transactions for `nextWaypointIndex` mitigates this.
- **Recommendation**: Defer this to a later phase. The pre-trip waypoint setup covers 90% of use cases.

---

## 7. Activity Feed Integration

New event types for the activity feed:

```javascript
// Waypoint arrival
{
  type: "waypoint_arrived",
  participantName: "Nandha",
  timestamp: Date.now(),
  detail: "Blue Bottle Coffee (Stop 1 of 3)"
}

// All waypoints completed (heading to final destination)
{
  type: "waypoints_complete",
  participantName: "Nandha",
  timestamp: Date.now(),
  detail: "All stops visited — heading to Times Square"
}
```

---

## 8. Backward Compatibility

- Sessions without `waypoints` field work exactly as before (the field is simply absent)
- `getETAWithRoute` with empty `waypoints` array = current single-leg behavior
- `legDetails` is only populated when waypoints exist
- `nextWaypointIndex`, `completedWaypoints`, `waypointArrivals` are only written when waypoints exist
- **No migration needed** — new fields are purely additive
- `normalizeSession()` defaults: `waypoints: rawData.waypoints || []`
- `normalizeParticipant()` defaults: `nextWaypointIndex: rawData.nextWaypointIndex ?? 0`, `completedWaypoints: rawData.completedWaypoints || []`, `waypointArrivals: rawData.waypointArrivals || {}`

---

## 9. Firebase Security Rules

```json
"waypoints": {
  ".validate": "newData.isArray()",
  "$index": {
    ".validate": "newData.hasChildren(['id', 'lat', 'lng', 'name', 'order'])"
  }
}
```

Write access: host and co-hosts only (same as `destination`).

Participant waypoint fields (`nextWaypointIndex`, `completedWaypoints`, `waypointArrivals`): self-write only (same as other participant location fields).

---

## 10. Implementation Phases

### Phase A — Core (Pre-trip waypoints)
1. Data model: add `waypoints` to session creation
2. Create.jsx: "Add a stop" UI with Places Autocomplete + reorder
3. directions.js: add waypoints parameter to `getETAWithRoute`
4. useGeolocation.js: waypoint arrival detection
5. Session.jsx: waypoint markers on map
6. ETAPanel.jsx: per-participant stop progress
7. Lobby.jsx: waypoint list display
8. normalizers.js: defaults for new fields
9. Security rules update

### Phase B — Polish
1. Progress dots visualization
2. Waypoint arrival celebrations (toast + haptic + activity feed)
3. "All stops visited" transition
4. Recap: include waypoint timing in SessionRecap

### Phase C — Mid-trip (Stretch)
1. Host "Add Stop" during active session
2. Index shifting logic
3. "Route updated" banner + recalculate prompt

---

## 11. Open Questions

1. **Should waypoint order be optimizable?** Google's `optimizeWaypoints: true` reorders stops for shortest total distance. Could offer as a toggle: "Optimize route" vs. "Keep my order."
2. **Per-waypoint arrival radius?** Currently all stops use the session's `arrivalRadius`. Some stops (e.g., "drive past the landmark") might need a larger radius.
3. **Waypoint types?** Could distinguish between "stop" (everyone should stop) vs. "pass-through" (just drive by, no arrival detection). Deferred for simplicity.
4. **Group vs. individual progress?** Currently each participant tracks their own waypoint progress. Should we add a "group arrived at stop 1" event when ALL going participants have arrived? Useful for coordinated group trips.
