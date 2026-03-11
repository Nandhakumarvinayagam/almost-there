# Almost There — Future Enhancement Plan

> **Last updated:** 2026-03-11 (Round 6 complete)
> Everything below is **not yet implemented**. For what's been built, see `CLAUDE.md` → "Current Build Status".

---

## Pending — Phase 4 Remaining

### Clone This Meetup — Lobby Button
- Add "Clone This Meetup" button in Lobby.jsx (alongside the existing Recap clone)
- Reads current session, strips participants, resets `state` to `"draft"`
- Pre-fills Create.jsx with destination, theme, logistics, customFields

### OG Meta Tags — Cloud Function
- Intercept crawler requests to `/session/{id}` via Cloud Function
- Return dynamic `<meta>` tags (title = meetup nickname, description = destination + guest count)
- Requires Firebase Blaze plan

---

## Enhancement Backlog

### Floating Reaction Bubbles (Enhancement 2.1)
- `statusEmoji` field and picker already built
- Add `ReactionBubble.jsx` — OverlayView showing active emoji ~50px above participant marker
- Fade in/out on set/clear; no new data model needed
- Estimated effort: Small

### Traffic-Aware ETA (Enhancement 3.3)
- Add `departureTime: 'now'` to Directions API call in `directions.js`
- Returns `duration_in_traffic` instead of `duration`
- Behind `ENABLE_TRAFFIC_AWARE_ETA` flag in `constants.js`
- **Blocker**: Verify Google Maps billing tier impact — may increase costs significantly

### PWA Install (Enhancement 3.4)
- `public/manifest.json` — app shell metadata (name, icons, theme color)
- `public/sw.js` — cache app shell ONLY (NOT map tiles or Firebase data)
- `beforeinstallprompt` banner in App.jsx
- Allows "Add to Home Screen" on mobile
- Estimated effort: Medium

### Low Battery Indicator (Usability F11)
- `src/hooks/useBattery.js` using Web Battery API (Chrome/Android only)
- Writes `lowBattery: true/false` to Firebase participant on change
- 🪫 icon next to participant name in ETA panel
- Complete no-op on Safari/Firefox (API not available)
- Estimated effort: Small

### "Who's Nearby" Toggle UI
- `nearbyStatus` field already in participant schema
- **Deferred** — requires location-sharing in scheduled state, which conflicts with the privacy principle that Maybe/Can't-Go users are never prompted for location
- Needs design rethink: possibly only show for "going" users who opt in

---

## Tier 4 — Future Features (Requires Auth / Backend)

| Feature | Requirement | Notes |
|---------|-------------|-------|
| User accounts | Firebase Auth (email/social) | Enables persistent identity, profile, session history across devices |
| Push notifications | FCM + Cloud Functions (Blaze plan) | "X is almost there!", "Meetup started", reminders for scheduled |
| Dynamic OG images | Cloud Functions | Per-session preview card with map snapshot, guest count, emoji |
| Server-side groups | Firestore | Recurring meetup groups, member lists, group history |
| Ride-share coordination | Routes API Distance Matrix | Pair nearby participants for carpooling; show shared routes |
| Privacy zones | Client + server validation | Allow participants to hide location within X meters of home/work |
| Calendar integration | Google Calendar API (OAuth) | Auto-create calendar events, sync updates |

---

## Directions API Migration Note

The current implementation uses the **Directions API** (legacy). Google's newer **Routes API** offers:
- `computeRoutes` — same functionality, better pricing, traffic-aware by default
- `computeRouteMatrix` — distance matrix for ride-share coordination
- Migration path: swap `DirectionsService` calls in `directions.js` with `fetch()` to Routes API REST endpoint
- **Do NOT migrate until a feature requires Routes API** (e.g., ride-share matrix)

---

## Pre-Enhancement Checklist

Before starting any enhancement:
1. Read CLAUDE.md thoroughly — understand the current architecture
2. Read normalizers.js — understand backward-compat pattern
3. Check if the feature touches `useCallback` in Session.jsx — watch for stale closures
4. If adding new participant fields → add to `normalizeParticipant()`
5. If adding new session fields → add to `normalizeSession()`
6. If the field is an array → add Firebase object-to-array coercion in normalizer
7. Test with both new sessions AND legacy sessions (missing fields)
8. Run `npm test` to verify normalizer tests pass
9. Build (`npx vite build`) before deploying
10. Deploy with `firebase deploy` (deploys both hosting + database rules)
