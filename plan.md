# Almost There — Refined Enhancement Execution Plan

# PWA Install · Low Battery Indicator · Context-Sensitive Help

> **Status:** Planning complete — ready for Claude Code execution
> **Date:** 2026-03-11
> **Constraint:** All three features are zero-cost, client-side only
> **Sources:** Synthesized from three independent plans; best decisions from each

---

## Table of Contents

1. [Three-Way Comparison: Key Decisions](#1-three-way-comparison)
2. [Execution Order](#2-execution-order)
3. [Feature A: Low Battery Indicator](#3-feature-a-low-battery-indicator)
4. [Feature B: Context-Sensitive Help](#4-feature-b-context-sensitive-help)
5. [Feature C: PWA Installation](#5-feature-c-pwa-installation)
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Claude Code Prompts (Sequential)](#7-claude-code-prompts-sequential)
8. [Post-Implementation Verification Checklist](#8-post-implementation-verification-checklist)

---

## 1. Three-Way Comparison

Where the three plans disagreed, here's what we're going with and why.

### Battery Threshold

| Plan          | Approach                      | Verdict                                                                     |
| ------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Plan 1 (mine) | Single threshold at 15%       | Too low — most phones are visibly struggling at 20%                         |
| Plan 2        | 20% down, 25% up (hysteresis) | ✅ **Adopted.** Prevents flapping when battery oscillates near the boundary |
| Plan 3        | Single threshold at 20%       | Good threshold but no hysteresis                                            |

**Decision:** Trigger `lowBattery: true` when level ≤ 0.20 AND not charging. Clear when level ≥ 0.25 OR charging. Two constants: `LOW_BATTERY_TRIGGER = 0.20` and `LOW_BATTERY_CLEAR = 0.25`.

### Battery UI: Local Banner vs Firebase Write vs Both

| Plan   | Approach                                                         | Verdict                  |
| ------ | ---------------------------------------------------------------- | ------------------------ |
| Plan 1 | Firebase write → 🪫 badge in ETAPanel visible to others          | Good for group awareness |
| Plan 2 | Same as Plan 1                                                   | —                        |
| Plan 3 | Local banner only — warns the user themselves, no Firebase write | Good for self-awareness  |

**Decision:** ✅ **Both.** The user gets a local amber banner (Plan 3's design — "Battery low (18%) — keep the app open or tracking may stop"). Other participants see a 🪫 badge in the ETAPanel (Plan 1's design). These serve different purposes: the banner is actionable advice for the user; the badge is context for friends wondering "why did their pin go stale?"

### Battery Hook Location

| Plan   | Approach                                              | Verdict                                                          |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Plan 1 | Standalone `useBattery.js` hook called in Session.jsx | ✅ **Adopted.** Covers full session lifecycle including pre-trip |
| Plan 2 | Integrate into `useGeolocation.js`                    | ❌ Rejected — only fires for "going" + trip-started participants |
| Plan 3 | Standalone hook, local state only                     | Adopted for local state; extended with Firebase writes           |

### Battery — Show on Map Markers?

| Plan   | Approach                      | Verdict                                                                               |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| Plan 1 | ETAPanel only, keep map clean | ✅ **Adopted.** Map is the hero; markers already carry avatar + emoji + stale dimming |
| Plan 2 | ETAPanel + ParticipantMarker  | ❌ Too much visual clutter on markers                                                 |
| Plan 3 | N/A (local banner only)       | —                                                                                     |

### Pulse Animation Trigger Signal

| Plan   | Approach                                                                 | Verdict                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 1 | `useEffect` on `myParticipant?.status === 'not-started'` with setTimeout | Simple but doesn't account for existing button animations                                                                                                           |
| Plan 3 | `useEffect` on `preUserLocation + preLocating` (NOT `locationJustReady`) | ✅ **Adopted.** `locationJustReady` auto-resets after 400ms which would cancel timers. `preUserLocation + preLocating` is the stable "location became ready" signal |

### Pulse CSS: box-shadow vs transform

| Plan   | Approach                                                                                                    | Verdict                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 1 | box-shadow pulse                                                                                            | ✅ **Correct approach** but didn't explain why                                                                                        |
| Plan 3 | box-shadow pulse, explicitly avoids transform to prevent conflict with `btn-location-ready` scale animation | ✅ **Adopted with rationale.** The existing `btn-location-ready` class uses `transform: scale()`, so our pulse must NOT use transform |

### Context Help: Additional Micro-Interactions

| Interaction                            | Plan 1 | Plan 2 | Plan 3 | Verdict                                                          |
| -------------------------------------- | ------ | ------ | ------ | ---------------------------------------------------------------- |
| CTA button pulse                       | ✅     | ✅     | ✅     | ✅ Include                                                       |
| "tap to share arrival time" micro-copy | ❌     | ✅     | ❌     | ✅ **Add** — pulse draws eyes, text explains why                 |
| Share button nudge                     | ✅     | ❌     | ❌     | ✅ Include — low-effort, helps hosts                             |
| ETA panel peek hint                    | ✅     | ❌     | ❌     | ✅ Include — one-shot, low risk                                  |
| "Keep app open" toast                  | ❌     | ❌     | ✅     | ✅ **Add** — addresses the web app's core limitation proactively |
| Haptic on map view entry               | ❌     | ✅     | ❌     | ✅ **Add** — one line using existing `haptic()` util             |

### Install Banner Placement

| Plan   | Placement                                        | Verdict                                                                        |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Plan 1 | Session.jsx only (above pre-trip bar)            | Too narrow                                                                     |
| Plan 2 | Home.jsx or settings menu                        | Good secondary location                                                        |
| Plan 3 | Both Home.jsx + Session.jsx (fixed bottom strip) | ✅ **Adopted.** Returning users see it on Home; active users see it in Session |

### Install Banner Position in Session.jsx

| Plan   | Position                                                          | Verdict                                                         |
| ------ | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Plan 1 | Inline above pre-trip bar                                         | Can get lost in the layout                                      |
| Plan 3 | Fixed-bottom strip above ETA panel, using `--panel-height` offset | ✅ **Adopted.** More visible, doesn't interfere with map/header |

### PWA Dismiss Persistence

| Plan   | Storage                              | Verdict                                                                    |
| ------ | ------------------------------------ | -------------------------------------------------------------------------- |
| Plan 1 | sessionStorage (resets on tab close) | Too aggressive — user sees it every session                                |
| Plan 3 | localStorage (persists forever)      | ✅ **Adopted.** If user explicitly dismisses, respect that across sessions |

### SW Registration Location

| Plan   | Location                                    | Verdict                                                  |
| ------ | ------------------------------------------- | -------------------------------------------------------- |
| Plan 1 | `<script>` in `index.html` before `</body>` | ✅ **Adopted.** Registers even if React fails to hydrate |
| Plan 2 | `main.jsx` (React entry point)              | ❌ Fragile — React error = no SW                         |
| Plan 3 | `index.html` (same as Plan 1)               | ✅                                                       |

### firebase.json Headers for sw.js

| Plan   | Approach                                                         | Verdict                                                                                       |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Plan 1 | Not mentioned                                                    | ❌ Critical gap                                                                               |
| Plan 3 | `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js` | ✅ **Adopted.** Without this, CDN-cached stale workers persist after deploys. This is a must. |

### iOS Safe Area with `black-translucent`

| Plan   | Approach                                                             | Verdict                                                                                      |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Plan 1 | Not mentioned                                                        | Gap                                                                                          |
| Plan 3 | Verify `.session-header` has `padding-top: env(safe-area-inset-top)` | ✅ **Adopted.** `black-translucent` overlaps content — must confirm safe-area padding exists |

### `apple-mobile-web-app-title` Meta Tag

| Plan   | Included?   | Verdict                                                                           |
| ------ | ----------- | --------------------------------------------------------------------------------- |
| Plan 1 | ❌ Missing  | —                                                                                 |
| Plan 3 | ✅ Included | ✅ **Adopted.** Without it, iOS defaults to the page `<title>` which may be wrong |

### SW Fetch Strategy for Same-Origin Requests

| Plan   | Approach                              | Verdict                                                                                                                                |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 1 | Explicit allowlist (`/assets/*` only) | Too restrictive — misses favicon, other static files                                                                                   |
| Plan 3 | All same-origin GET → cache-first     | ✅ **Adopted.** Simpler, covers everything. Vite hashed bundles are naturally busted. External APIs are already excluded by the regex. |

### Icon Format

| Plan   | Approach                       | Verdict                                                                                               |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Plan 1 | Two PNGs (192 + 512)           | Standard, maximum compatibility                                                                       |
| Plan 3 | SVG + PNG for apple-touch-icon | SVG with `"sizes": "any"` is cleaner, but some older Android WebViews don't render SVG manifest icons |

**Decision:** ✅ **Generate PNGs** (192 + 512) for maximum compatibility. Also create `apple-touch-icon.png` at 180×180 for iOS. Use a one-off Node script to render a simple icon (dark blue circle + white pin silhouette).

### Execution Order

| Plan   | Order                | Rationale                                         |
| ------ | -------------------- | ------------------------------------------------- |
| Plan 1 | PWA → Battery → Help | Risk isolation (PWA touches only new files first) |
| Plan 2 | Help → Battery → PWA | Speed (help is fastest, immediate impact)         |
| Plan 3 | Battery → Help → PWA | Lowest risk to highest complexity                 |

**Decision:** ✅ **Battery → Help → PWA** (Plan 3's order). Rationale: Battery is a standalone hook with minimal Session.jsx integration — lowest risk, establishes the "secondary status" pattern. Help builds on that Session.jsx familiarity with pure CSS additions. PWA is highest complexity (new files + `firebase.json` + multi-page install banner) and benefits from the developer being fully warmed up on the codebase.

---

## 2. Execution Order

| Step | Feature                                                         | Files Touched                                                                  | Risk       |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| 1    | Battery — hook + constants + normalizer                         | `constants.js`, `useBattery.js` (new), `normalizers.js`, `normalizers.test.js` | Low        |
| 2    | Battery — UI (local banner + ETAPanel badge)                    | `Session.jsx`, `ETAPanel.jsx`, `index.css`                                     | Low–Medium |
| 3    | Help — CTA pulse + micro-copy hint                              | `index.css`, `Session.jsx`                                                     | Medium     |
| 4    | Help — "Keep app open" toast + share nudge + peek hint + haptic | `Session.jsx`, `ETAPanel.jsx`, `index.css`                                     | Low        |
| 5    | PWA — manifest + icons + index.html + firebase.json             | `manifest.json` (new), icons (new), `index.html`, `firebase.json`              | Low        |
| 6    | PWA — service worker                                            | `sw.js` (new)                                                                  | Low        |
| 7    | PWA — install prompt hook + Home.jsx + Session.jsx banners      | `useInstallPrompt.js` (new), `Home.jsx`, `Session.jsx`, `index.css`            | Medium     |

---

## 3. Feature A: Low Battery Indicator

### 3.1 Design Summary

Two complementary UIs from a single hook:

1. **Local banner** (self-warning): Amber banner in Session.jsx's banner area, styled like the existing offline banner. Shows battery percentage and actionable advice. Only the user sees this.
2. **Firebase badge** (group awareness): `lowBattery: true` written to participant node in Firebase. Other participants see a 🪫 emoji next to the name in ETAPanel.

### 3.2 Constants

```
LOW_BATTERY_TRIGGER  = 0.20   // show warning at ≤ 20%
LOW_BATTERY_CLEAR    = 0.25   // clear warning at ≥ 25% (hysteresis)
```

Both go in `constants.js`.

### 3.3 useBattery.js Hook

```
Input:  participantRef (Firebase ref or null)
Output: { supported: boolean, isLowBattery: boolean, level: number|null, charging: boolean|null }

Behavior:
1. Feature detect: if !navigator.getBattery → return { supported: false, isLowBattery: false, level: null, charging: null }
2. Call navigator.getBattery() in useEffect
3. Track state: { level, charging } via useState
4. Hysteresis logic (computed, not stored):
   - If currently NOT low: trigger when !charging && level <= LOW_BATTERY_TRIGGER
   - If currently IS low: clear when charging || level >= LOW_BATTERY_CLEAR
5. Firebase write: update(participantRef, { lowBattery }) — ONLY when boolean changes
   - Uses prevLowRef to compare; avoids unnecessary writes
   - MUST use update() not set() — set() destroys the entire participant node
6. Named event handlers (NOT anonymous lambdas) for levelchange + chargingchange
   - This is critical: removeEventListener requires the same function reference
7. Cleanup on unmount:
   - Remove both event listeners
   - Write update(participantRef, { lowBattery: false }) to clear indicator when user leaves
```

**Why expose `level` and `charging` in addition to `isLowBattery`?** The local banner shows the actual percentage ("Battery low (18%)"). The Firebase write is boolean-only (privacy-conscious).

### 3.4 Normalizer Update

In `normalizeParticipant()`:

```
lowBattery: raw.lowBattery ?? false
```

Test: verify missing field defaults to `false`.

### 3.5 Session.jsx Integration

```jsx
// Hook call (near other hooks):
const battery = useBattery(myParticipantRef);

// Local banner (inside session-banners div, after offline banner):
{
  battery.isLowBattery && (
    <div className="battery-banner" role="status" aria-live="polite">
      <MatIcon name="battery_alert" size={16} />
      <span>
        Battery low ({Math.round(battery.level * 100)}%) — keep the app open or
        tracking may stop
      </span>
    </div>
  );
}
```

The banner auto-dismisses when `isLowBattery` flips to `false` (charging or recovered). No extra dismiss state needed.

### 3.6 ETAPanel.jsx Integration

```jsx
// After participant name span:
{
  participant.lowBattery && (
    <span
      className="low-battery-badge"
      title="Low battery"
      aria-label="Low battery"
    >
      🪫
    </span>
  );
}
```

### 3.7 CSS

```css
.battery-banner {
  /* Match existing .offline-banner pattern: amber-100/900 tones, same height/padding */
}
@media (prefers-color-scheme: dark) {
  /* amber dark tokens */
}

.low-battery-badge {
  font-size: 14px;
  margin-left: 4px;
  vertical-align: middle;
}
```

### 3.8 Files Touched

| File                            | Action                                              | Risk   |
| ------------------------------- | --------------------------------------------------- | ------ |
| `src/config/constants.js`       | Edit — add 2 constants                              | Low    |
| `src/hooks/useBattery.js`       | Create                                              | None   |
| `src/utils/normalizers.js`      | Edit — 1 line in `normalizeParticipant`             | Low    |
| `src/utils/normalizers.test.js` | Edit — 1 test case                                  | Low    |
| `src/pages/Session.jsx`         | Edit — import hook, add banner JSX                  | Medium |
| `src/components/ETAPanel.jsx`   | Edit — add 🪫 badge                                 | Low    |
| `src/index.css`                 | Edit — add `.battery-banner` + `.low-battery-badge` | Low    |

---

## 4. Feature B: Context-Sensitive Help

### 4.1 Micro-Interactions Catalog

| ID  | Interaction                                | Trigger                           | Duration                                | Fires                             |
| --- | ------------------------------------------ | --------------------------------- | --------------------------------------- | --------------------------------- |
| B1  | CTA button pulse                           | Location ready + 3s delay         | 3 cycles (~5.4s)                        | Once per session (sessionStorage) |
| B2  | "Tap to share your arrival time" hint text | Same as B1                        | Fades in with pulse, persists until tap | Once per session                  |
| B3  | Share button nudge                         | ≤1 participant + 5s delay         | Single bounce (0.4s)                    | Once per component mount          |
| B4  | ETA panel peek hint                        | Trip started + panel in peek + 5s | Single bounce (0.5s)                    | Once per component lifetime (ref) |
| B5  | "Keep app open" toast                      | First-ever active session join    | 8s auto-dismiss                         | Once ever (localStorage)          |
| B6  | Haptic on map view entry                   | Active session mount              | Instant                                 | Once per session entry            |

### 4.2 B1 — CTA Button Pulse

**Critical implementation detail from Plan 3:** The existing `locationJustReady` state auto-resets after 400ms (line ~626 in Session.jsx). A `useEffect` depending on it would have its cleanup cancel the 3-second timer when it flips back to `false`. Instead, depend on `preUserLocation` + `preLocating` as the stable "location became ready" signal.

**CSS (must use box-shadow, NOT transform):**

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes btn-attention-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0px rgba(37, 99, 235, 0);
    }
    50% {
      box-shadow: 0 0 0 10px rgba(37, 99, 235, 0.28);
    }
  }
  .btn-attention-pulse {
    animation: btn-attention-pulse 1.8s ease-in-out 3; /* 3 cycles */
  }
}
```

**Why box-shadow?** The existing `btn-location-ready` class uses `transform: scale()`. Using `transform` for our pulse would conflict and override the scale animation. `box-shadow` is an independent property.

**React logic:**

```jsx
const [showAttentionPulse, setShowAttentionPulse] = useState(false);
const pulseFiredRef = useRef(false);
const pulseTimerRef = useRef(null);

useEffect(() => () => clearTimeout(pulseTimerRef.current), []); // unmount cleanup

useEffect(() => {
  if (!preUserLocation || preLocating) return; // location not ready yet
  if (pulseFiredRef.current) return; // already fired
  if (sessionStorage.getItem(`pulse-seen-${sessionId}`)) return; // already seen
  pulseFiredRef.current = true;
  sessionStorage.setItem(`pulse-seen-${sessionId}`, "true");
  pulseTimerRef.current = setTimeout(() => setShowAttentionPulse(true), 3_000);
}, [preUserLocation, preLocating, sessionId]);

// In handleStartTripClick — clear pulse immediately:
setShowAttentionPulse(false);
clearTimeout(pulseTimerRef.current);
```

**Button className:**

```jsx
className={`btn btn-success btn-full${locationJustReady ? ' btn-location-ready' : ''}${showAttentionPulse && !startingPhase ? ' btn-attention-pulse' : ''}`}
```

### 4.3 B2 — Micro-Copy Hint Text

When the pulse fires, also show a small text line below the button:

```jsx
{
  showAttentionPulse && !startingPhase && (
    <p className="hint-text">Tap to share your arrival time</p>
  );
}
```

```css
.hint-text {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  margin-top: 4px;
  animation: fade-in 0.5s ease;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

### 4.4 B3 — Share Button Nudge

```jsx
const [showShareNudge, setShowShareNudge] = useState(false);

useEffect(() => {
  const participantCount = Object.keys(session?.participants || {}).length;
  if (participantCount > 1) return;
  const t = setTimeout(() => setShowShareNudge(true), 5_000);
  return () => clearTimeout(t);
}, []);  // only on mount

// On share button:
className={`... ${showShareNudge ? 'share-btn--nudge' : ''}`}
onAnimationEnd={() => setShowShareNudge(false)}
```

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes nudge-bounce {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
    }
  }
  .share-btn--nudge {
    animation: nudge-bounce 0.4s ease-in-out 1;
  }
}
```

### 4.5 B4 — ETA Panel Peek Hint

In `ETAPanel.jsx`:

```jsx
const hasHintedRef = useRef(false);
const [showPeekHint, setShowPeekHint] = useState(false);

useEffect(() => {
  if (hasHintedRef.current) return;
  if (!isAtPeek || !hasEnRouteParticipants) return;
  hasHintedRef.current = true;
  const t = setTimeout(() => {
    setShowPeekHint(true);
    setTimeout(() => setShowPeekHint(false), 500);
  }, 5_000);
  return () => clearTimeout(t);
}, [isAtPeek, hasEnRouteParticipants]);

// On drag handle:
className={`drag-handle ${showPeekHint ? 'drag-handle--hint' : ''}`}
```

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes peek-hint {
    0% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
    100% {
      transform: translateY(0);
    }
  }
  .drag-handle--hint {
    animation: peek-hint 0.5s ease-in-out 1;
  }
}
```

### 4.6 B5 — "Keep App Open" Toast

Reuses existing `showToast` from Session.jsx and follows the established `navTip` localStorage pattern:

```jsx
const keepOpenHintFiredRef = useRef(false);

useEffect(() => {
  if (!participantId) return;
  if (keepOpenHintFiredRef.current) return;
  if (localStorage.getItem("hasSeenKeepOpenHint")) return;
  keepOpenHintFiredRef.current = true;
  localStorage.setItem("hasSeenKeepOpenHint", "true");
  const t = setTimeout(
    () => showToast("Keep this tab open for live updates", 8_000),
    2_000,
  );
  return () => clearTimeout(t);
}, [participantId, showToast]);
```

Fires once ever across all sessions. The 2-second delay prevents overwhelming the user on initial load.

### 4.7 B6 — Haptic on Map View Entry

One line using the existing `haptic()` utility from `utils/haptic.js`:

```jsx
useEffect(() => {
  haptic("light"); // one-shot on active session mount
}, []);
```

Already a no-op on iOS (the `haptic()` util wraps `navigator.vibrate` which Safari ignores).

### 4.8 Annoyance Prevention Summary

| Guard                              | Mechanism                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Pulse fires once per session       | `sessionStorage` keyed to `pulse-seen-${sessionId}`                    |
| Toast fires once ever              | `localStorage` `hasSeenKeepOpenHint`                                   |
| Share nudge fires once per mount   | `onAnimationEnd` clears state                                          |
| Peek hint fires once per component | `useRef` boolean                                                       |
| Reduced motion respected           | All animations inside `@media (prefers-reduced-motion: no-preference)` |
| User interaction cancels pulse     | `handleStartTripClick` clears state + timer                            |

### 4.9 Files Touched

| File                          | Action                                                                         | Risk                                     |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `src/index.css`               | Edit — 4 `@keyframes` + conditional classes + `prefers-reduced-motion` wrapper | Low                                      |
| `src/pages/Session.jsx`       | Edit — pulse state, toast effect, share nudge, haptic                          | Medium (isolated to specific JSX blocks) |
| `src/components/ETAPanel.jsx` | Edit — peek hint on drag handle                                                | Low                                      |

---

## 5. Feature C: PWA Installation

### 5.1 manifest.json

Location: `public/manifest.json`

```json
{
  "name": "Almost There",
  "short_name": "Almost There",
  "description": "Share your live location with friends.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0066CC",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

**Notes:**

- `background_color: "#0f172a"` — dark blue, matches the app's dark mode body. This is the splash screen background color.
- `"purpose": "any"` — NOT `"maskable"`. Using `"maskable"` without a properly designed safe-zone icon causes ugly cropping. `"any"` is the safe default.
- `"orientation": "portrait-primary"` — more specific than `"portrait"`, prevents upside-down orientation.

### 5.2 Icon Generation

Generate three PNGs programmatically via a one-off Node script (no new runtime dependency):

| File                                | Size    | Purpose                       |
| ----------------------------------- | ------- | ----------------------------- |
| `public/icons/icon-192.png`         | 192×192 | Chrome manifest icon          |
| `public/icons/icon-512.png`         | 512×512 | Chrome manifest icon + splash |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home screen icon          |

**Design:** Dark blue (#0f172a) rounded-rect background with a white location-pin silhouette centered. Simple, recognizable, matches the destination marker aesthetic.

**Script approach:** Use Node's built-in capabilities or the `canvas` npm package (one-time dev dependency, not a runtime dependency) to render the icon. Alternatively, write raw SVG and convert via a headless browser. The script lives in `scripts/generate-icons.mjs` and is run once manually, not part of the build pipeline.

### 5.3 index.html Changes

In `<head>`:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0066CC" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta
  name="apple-mobile-web-app-status-bar-style"
  content="black-translucent"
/>
<meta name="apple-mobile-web-app-title" content="Almost There" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

Before `</body>`:

```html
<script>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function (e) {
        console.warn("SW registration failed:", e);
      });
    });
  }
</script>
```

**iOS safe-area check:** The `black-translucent` status bar style causes the status bar to overlay page content. Verify that `.session-header` already has `padding-top: env(safe-area-inset-top)`. If not, add it. (Round 5 notes mention safe-area-inset work was done, but verify.)

### 5.4 firebase.json — Cache Headers

**This is critical and was missing from Plan 1.** Without these headers, Firebase Hosting's CDN can cache `sw.js`, causing stale workers to persist after deploys.

Add to the `hosting` config:

```json
"headers": [
  {
    "source": "/sw.js",
    "headers": [
      { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
    ]
  },
  {
    "source": "/manifest.json",
    "headers": [
      { "key": "Cache-Control", "value": "public, max-age=3600" }
    ]
  }
]
```

### 5.5 Service Worker Strategy

Location: `public/sw.js` — hand-written, no Workbox, no build plugin.

**Cache name:** `almost-there-shell-v1` (bump on breaking SW changes)

**Install event:**

- Pre-cache: `["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"]`
- Call `self.skipWaiting()`

**Activate event:**

- Delete all caches where key !== current cache name
- Call `self.clients.claim()`

**Fetch event routing:**

| Request Type                                                                   | Strategy                              | Rationale                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `request.mode === 'navigate'`                                                  | Network-first, fallback to cached `/` | SPA — always try to serve latest `index.html`, but work offline                                               |
| URL matches `/firebaseio\.com\|googleapis\.com\|maps\.gstatic\.com\|fonts\.g/` | Pure `fetch()` — no cache interaction | Dynamic/API-gated content; caching would break real-time or violate ToS                                       |
| Same-origin GET                                                                | Cache-first, populate on miss         | Covers Vite hashed bundles (`/assets/index-[hash].js`), favicon, icons. Hashed filenames auto-bust on deploy. |
| Everything else                                                                | Network-only                          | Safety default                                                                                                |

**Why same-origin GET cache-first works without staleness:** Vite generates content-hashed filenames. When we deploy a new build, `index.html` (network-first) references new hashed URLs. The old cached bundles are never requested again. On the next activate, old caches are purged. This is simpler than an explicit allowlist and naturally covers all static assets.

**Total file size:** ~45 lines.

### 5.6 useInstallPrompt.js Hook

```
State:
- deferredPrompt: useRef (stores the beforeinstallprompt event)
- canInstall: boolean (useState)
- dismissed: derived from localStorage('pwaInstallDismissed')

Behavior:
- Listen for 'beforeinstallprompt' → preventDefault, stash event, set canInstall = true
  (only if localStorage 'pwaInstallDismissed' is NOT set)
- Listen for 'appinstalled' → set canInstall = false, clear ref
- promptInstall(): call deferredPrompt.current.prompt(), await userChoice, set canInstall = false
- dismiss(): set localStorage flag, set canInstall = false

Expose: { canInstall, promptInstall, dismiss }
```

**localStorage (not sessionStorage):** If the user explicitly dismisses, respect that across sessions. They can always install via browser menu.

### 5.7 Install Banner — Dual Placement

**Session.jsx** — Fixed-bottom strip above ETA panel:

```jsx
{
  canInstall && (
    <div className="pwa-install-banner">
      <MatIcon name="install_mobile" size={18} />
      <span>Add to home screen for quick access</span>
      <button onClick={promptInstall}>Install</button>
      <button onClick={dismiss} aria-label="Dismiss">
        <MatIcon name="close" size={18} />
      </button>
    </div>
  );
}
```

**Home.jsx** — Same banner at page bottom (inline or fixed):

```jsx
// Import useInstallPrompt, render identical banner
{
  canInstall && (
    <div className="pwa-install-banner pwa-install-banner--home">
      ...same content...
    </div>
  );
}
```

### 5.8 Install Banner CSS

```css
.pwa-install-banner {
  position: fixed;
  bottom: calc(var(--panel-height, 160px) + 8px);
  left: 16px;
  right: 16px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-m);
  font-size: 14px;
  animation: banner-fade-in 0.25s ease;
}

.pwa-install-banner--home {
  position: relative; /* inline at bottom of Home page */
  bottom: auto;
  margin: 16px;
}

@media (min-width: 768px) {
  .pwa-install-banner {
    bottom: 24px;
    left: 24px;
    right: auto;
    max-width: 360px;
  }
}
```

### 5.9 Files Touched

| File                                | Action                                  | Risk           |
| ----------------------------------- | --------------------------------------- | -------------- |
| `public/manifest.json`              | Create                                  | None           |
| `public/icons/icon-192.png`         | Create                                  | None           |
| `public/icons/icon-512.png`         | Create                                  | None           |
| `public/icons/apple-touch-icon.png` | Create                                  | None           |
| `public/sw.js`                      | Create                                  | None           |
| `index.html`                        | Edit — meta tags + SW registration      | Low            |
| `firebase.json`                     | Edit — add headers block                | Low (additive) |
| `src/hooks/useInstallPrompt.js`     | Create                                  | None           |
| `src/pages/Session.jsx`             | Edit — import hook, render banner       | Medium         |
| `src/pages/Home.jsx`                | Edit — import hook, render banner       | Low            |
| `src/index.css`                     | Edit — add `.pwa-install-banner` styles | Low            |

---

## 6. Cross-Cutting Concerns

### 6.1 Session.jsx Cumulative Impact

Session.jsx is touched by all three features. Here's the isolation map:

| Feature            | What's Added                                            | JSX Location                                    |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| Battery            | `useBattery()` call + amber banner                      | Banner area (with offline/reconnecting banners) |
| Help — pulse       | `useState` + `useEffect` + className on existing button | Pre-trip bar section                            |
| Help — hint text   | `<p>` below CTA button                                  | Pre-trip bar section                            |
| Help — toast       | `useEffect` with `showToast`                            | Hook section (no JSX)                           |
| Help — share nudge | `useState` + className on existing button               | Header section                                  |
| Help — haptic      | One-line `useEffect`                                    | Hook section (no JSX)                           |
| PWA                | `useInstallPrompt()` call + fixed-bottom banner         | New JSX block above `</div>`                    |

**No two features touch the same JSX element.** The pulse and hint text are in the pre-trip bar. The battery banner is in the banners section. The PWA banner is a new fixed-position element. The share nudge is on the header share button. All isolated.

**Stale closure analysis:** None of these reference reactive session data inside `useCallback`. The battery hook takes a ref (stable). The pulse depends on `preUserLocation`/`preLocating` (stable signals). The install hook uses browser events only. No stale closure risk.

### 6.2 update() vs set() — Battery Writes

`useBattery` writes `{ lowBattery: isLow }` to the participant ref. This MUST use `update()`. Using `set()` would destroy the participant's name, location, RSVP, and every other field. The prompt instructions explicitly call out `update` from `firebase/database`.

### 6.3 Normalizer Backward Compatibility

Only one new field: `lowBattery` in `normalizeParticipant()`. Default: `false`. Legacy sessions, unsupported browsers, and non-active participants all correctly show no indicator.

### 6.4 No New Runtime Dependencies

All three features use built-in browser APIs and existing utilities. The icon generation script may use the `canvas` npm package as a one-time dev tool, but it's not a runtime dependency and not part of the build pipeline.

### 6.5 Build & Deploy

Standard flow: `npm run build` → `firebase deploy`. The only non-obvious step is running `scripts/generate-icons.mjs` once to create the PNG icons before the first build. After that, the icons are static assets in `public/icons/`.

---

## 7. Claude Code Prompts (Sequential)

### Prompt 1 — Low Battery: Hook + Constants + Normalizer

**Scope:** `src/config/constants.js`, `src/hooks/useBattery.js` (new), `src/utils/normalizers.js`, `src/utils/normalizers.test.js`

**Instructions:**

- Add to `constants.js`: `LOW_BATTERY_TRIGGER = 0.20` and `LOW_BATTERY_CLEAR = 0.25`
- Create `src/hooks/useBattery.js`:
  - Import: `{ useState, useEffect, useRef }` from react, `{ update }` from `firebase/database`, constants
  - Signature: `useBattery(participantRef)`
  - Feature detect: if `!navigator.getBattery` or `!participantRef` → return `{ supported: false, isLowBattery: false, level: null, charging: null }`
  - `useState` for `{ level, charging }`, `useState` for `isLowBattery`
  - `useEffect(deps: [participantRef])`:
    - `navigator.getBattery().then(battery => { ... })`
    - Define NAMED handler functions `onLevelChange` and `onChargingChange` (NOT anonymous — `removeEventListener` requires same reference)
    - Each handler: update `level`/`charging` state from `battery.level`/`battery.charging`
    - Hysteresis: separate `useEffect(deps: [level, charging, participantRef])` computes:
      - If `!isLowBattery`: trigger when `!charging && level !== null && level <= LOW_BATTERY_TRIGGER`
      - If `isLowBattery`: clear when `charging || (level !== null && level >= LOW_BATTERY_CLEAR)`
      - On change: `setIsLowBattery(newVal)`, `update(participantRef, { lowBattery: newVal })`
      - Track previous value in `prevLowRef` to avoid redundant Firebase writes
    - Cleanup: remove both event listeners; `update(participantRef, { lowBattery: false })`
  - Return `{ supported: true, isLowBattery, level, charging }`
- Edit `normalizers.js` → `normalizeParticipant()`: add `lowBattery: raw.lowBattery ?? false`
- Edit `normalizers.test.js`: add test case — empty object → `result.lowBattery === false`

### Prompt 2 — Low Battery: UI (Banner + ETAPanel Badge)

**Scope:** `src/pages/Session.jsx`, `src/components/ETAPanel.jsx`, `src/index.css`

**Instructions:**

- Edit `Session.jsx`:
  - Import `useBattery` from hooks
  - Call `const battery = useBattery(myParticipantRef)` near other hook calls in the active-session section
  - Determine `myParticipantRef`: this should be the Firebase ref for the current user's participant node. Check if `useSession` already exposes it. If not, construct it: `ref(db, \`sessions/${sessionId}/participants/${participantId}\`)` — all these variables should already be in scope. Only pass the ref when the session is active and the user has joined.
  - In the banner area (`.session-banners` div), AFTER the `!isOnline` offline banner, add:
    ```jsx
    {
      battery.isLowBattery && (
        <div className="battery-banner" role="status" aria-live="polite">
          <MatIcon name="battery_alert" size={16} />
          <span>
            Battery low ({Math.round(battery.level * 100)}%) — keep the app open
            or tracking may stop
          </span>
        </div>
      );
    }
    ```
- Edit `ETAPanel.jsx`:
  - In each participant row, after the name `<span>`, add:
    ```jsx
    {
      participant.lowBattery && (
        <span
          className="low-battery-badge"
          title="Low battery"
          aria-label="Low battery"
        >
          🪫
        </span>
      );
    }
    ```
- Edit `index.css`:
  - `.battery-banner`: match `.offline-banner` pattern — amber-100 bg (`#FEF3C7`), amber-900 text (`#78350F`), same height/padding/border-radius, flex row, gap 8px, `font-size: 13px`
  - Dark mode: amber-900 bg (`#78350F`), amber-100 text
  - `.low-battery-badge`: `font-size: 14px; margin-left: 4px; vertical-align: middle;`

### Prompt 3 — Context Help: CTA Pulse + Micro-Copy Hint

**Scope:** `src/index.css`, `src/pages/Session.jsx`

**Instructions:**

- Add to `index.css`, wrapped in `@media (prefers-reduced-motion: no-preference)`:
  ```css
  @keyframes btn-attention-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0px rgba(37, 99, 235, 0);
    }
    50% {
      box-shadow: 0 0 0 10px rgba(37, 99, 235, 0.28);
    }
  }
  .btn-attention-pulse {
    animation: btn-attention-pulse 1.8s ease-in-out 3;
  }
  ```
- Add `.hint-text` class: `font-size: 12px; color: var(--text-secondary); text-align: center; margin-top: 4px; animation: fade-in 0.5s ease;`
- Add `@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }`

- Edit `Session.jsx`:
  - Add state + refs near the `locationJustReady` state block:
    ```jsx
    const [showAttentionPulse, setShowAttentionPulse] = useState(false);
    const pulseFiredRef = useRef(false);
    const pulseTimerRef = useRef(null);
    useEffect(() => () => clearTimeout(pulseTimerRef.current), []);
    ```
  - Add `useEffect` depending on `preUserLocation` and `preLocating` (NOT `locationJustReady`):
    ```jsx
    useEffect(() => {
      if (!preUserLocation || preLocating) return;
      if (pulseFiredRef.current) return;
      if (sessionStorage.getItem(`pulse-seen-${sessionId}`)) return;
      pulseFiredRef.current = true;
      sessionStorage.setItem(`pulse-seen-${sessionId}`, "true");
      pulseTimerRef.current = setTimeout(
        () => setShowAttentionPulse(true),
        3_000,
      );
    }, [preUserLocation, preLocating, sessionId]);
    ```
  - In `handleStartTripClick`, add at the very top: `setShowAttentionPulse(false); clearTimeout(pulseTimerRef.current);`
  - On the "I'm Leaving Now" button, extend className: append `${showAttentionPulse && !startingPhase ? ' btn-attention-pulse' : ''}`
  - Below the button, add: `{showAttentionPulse && !startingPhase && (<p className="hint-text">Tap to share your arrival time</p>)}`

### Prompt 4 — Context Help: Toast + Share Nudge + Peek Hint + Haptic

**Scope:** `src/pages/Session.jsx`, `src/components/ETAPanel.jsx`, `src/index.css`

**Instructions:**

- **"Keep app open" toast** — Add to Session.jsx after the `navTipTimerRef` block:

  ```jsx
  const keepOpenHintFiredRef = useRef(false);
  useEffect(() => {
    if (!participantId) return;
    if (keepOpenHintFiredRef.current) return;
    if (localStorage.getItem("hasSeenKeepOpenHint")) return;
    keepOpenHintFiredRef.current = true;
    localStorage.setItem("hasSeenKeepOpenHint", "true");
    const t = setTimeout(
      () => showToast("Keep this tab open for live updates", 8_000),
      2_000,
    );
    return () => clearTimeout(t);
  }, [participantId, showToast]);
  ```

- **Haptic on map view entry** — Add to Session.jsx:

  ```jsx
  useEffect(() => {
    haptic("light");
  }, []);
  ```

  (Import `haptic` from `utils/haptic.js` if not already imported.)

- **Share button nudge** — Add to Session.jsx:

  ```jsx
  const [showShareNudge, setShowShareNudge] = useState(false);
  useEffect(() => {
    const count = Object.keys(session?.participants || {}).length;
    if (count > 1) return;
    const t = setTimeout(() => setShowShareNudge(true), 5_000);
    return () => clearTimeout(t);
  }, []);
  ```

  On the share icon button, add: `className={`...${showShareNudge ? ' share-btn--nudge' : ''}`}` and `onAnimationEnd={() => setShowShareNudge(false)}`

- Add to `index.css` (inside `@media (prefers-reduced-motion: no-preference)`):

  ```css
  @keyframes nudge-bounce {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
    }
  }
  .share-btn--nudge {
    animation: nudge-bounce 0.4s ease-in-out 1;
  }

  @keyframes peek-hint {
    0% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
    100% {
      transform: translateY(0);
    }
  }
  .drag-handle--hint {
    animation: peek-hint 0.5s ease-in-out 1;
  }
  ```

- **ETA panel peek hint** — Edit `ETAPanel.jsx`:
  ```jsx
  const hasHintedRef = useRef(false);
  const [showPeekHint, setShowPeekHint] = useState(false);
  useEffect(() => {
    if (hasHintedRef.current) return;
    if (!isAtPeek || !hasEnRouteParticipants) return;
    hasHintedRef.current = true;
    const t = setTimeout(() => {
      setShowPeekHint(true);
      setTimeout(() => setShowPeekHint(false), 500);
    }, 5_000);
    return () => clearTimeout(t);
  }, [isAtPeek, hasEnRouteParticipants]);
  ```
  On the drag handle element, add: `className={`drag-handle${showPeekHint ? ' drag-handle--hint' : ''}`}`

### Prompt 5 — PWA: Manifest + Icons + index.html + firebase.json

**Scope:** `public/manifest.json` (new), `public/icons/` (new dir + 3 PNGs), `index.html`, `firebase.json`, optionally `scripts/generate-icons.mjs`

**Instructions:**

- Create `public/icons/` directory
- Generate icons: Write a Node script `scripts/generate-icons.mjs` that creates three PNG files:
  - `public/icons/icon-192.png` (192×192) — dark blue (#0f172a) background, white location-pin shape centered
  - `public/icons/icon-512.png` (512×512) — same design
  - `public/icons/apple-touch-icon.png` (180×180) — same design, slightly rounded corners if possible
  - Use the `canvas` npm package (`npm install canvas --save-dev`) OR write raw PNG bytes. Run the script once: `node scripts/generate-icons.mjs`
- Create `public/manifest.json` with the exact JSON from Section 5.1
- Edit `index.html` `<head>`: add the 6 meta/link tags from Section 5.3
- Edit `index.html` before `</body>`: add the SW registration script from Section 5.3
- Edit `firebase.json` → `hosting` → add `"headers"` array from Section 5.4
  - Verify this is placed correctly within the existing hosting config (alongside `rewrites`, `public`, etc.)
- **Verify** `.session-header` CSS has `padding-top: env(safe-area-inset-top)` — if missing, add it to `index.css`

### Prompt 6 — PWA: Service Worker

**Scope:** `public/sw.js` (new)

**Instructions:**

- Create `public/sw.js` with:
  - `const CACHE_NAME = 'almost-there-shell-v1';`
  - `const PRE_CACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];`
  - `const EXTERNAL_RE = /firebaseio\.com|googleapis\.com|maps\.gstatic\.com|fonts\.g(oo|static)leapis\.com/;`
  - `install` event: open cache, addAll PRE_CACHE, `self.skipWaiting()`
  - `activate` event: iterate `caches.keys()`, delete any key !== CACHE_NAME, `self.clients.claim()`
  - `fetch` event:
    1. Non-GET requests → `fetch(event.request)` (pass through)
    2. `event.request.mode === 'navigate'` → network-first: try `fetch`, on success cache the response clone as `/`, on failure return `caches.match('/')`
    3. URL matches `EXTERNAL_RE` → `fetch(event.request)` (no cache)
    4. Same-origin GET → cache-first: try `caches.match(request)`, if hit return it. If miss, `fetch`, clone response into cache, return response.
  - Total: ~45 lines, no imports, no Workbox

### Prompt 7 — PWA: Install Prompt Hook + Home.jsx + Session.jsx Banners

**Scope:** `src/hooks/useInstallPrompt.js` (new), `src/pages/Home.jsx`, `src/pages/Session.jsx`, `src/index.css`

**Instructions:**

- Create `src/hooks/useInstallPrompt.js`:
  - `deferredPrompt` as `useRef(null)`
  - `canInstall` as `useState(false)`
  - `useEffect` on mount:
    - Check `localStorage.getItem('pwaInstallDismissed')` — if set, skip all listeners
    - Add `beforeinstallprompt` listener: `e.preventDefault()`, stash in ref, `setCanInstall(true)`
    - Add `appinstalled` listener: `setCanInstall(false)`, clear ref
    - Cleanup: remove both listeners
  - `promptInstall`: call `deferredPrompt.current.prompt()`, await `deferredPrompt.current.userChoice`, `setCanInstall(false)`, clear ref
  - `dismiss`: `localStorage.setItem('pwaInstallDismissed', 'true')`, `setCanInstall(false)`
  - Return `{ canInstall, promptInstall, dismiss }`

- Edit `Session.jsx`:
  - Import `useInstallPrompt`
  - Call `const { canInstall, promptInstall, dismiss: dismissInstall } = useInstallPrompt()`
  - Add banner JSX (fixed-bottom, above ETA panel):
    ```jsx
    {
      canInstall && (
        <div className="pwa-install-banner">
          <MatIcon name="install_mobile" size={18} />
          <span>Add to home screen for quick access</span>
          <button className="pwa-install-btn" onClick={promptInstall}>
            Install
          </button>
          <button
            className="pwa-install-dismiss"
            onClick={dismissInstall}
            aria-label="Dismiss"
          >
            <MatIcon name="close" size={18} />
          </button>
        </div>
      );
    }
    ```

- Edit `Home.jsx`:
  - Import `useInstallPrompt`
  - Call the hook, render same banner with `.pwa-install-banner--home` variant class at the bottom of the page

- Add to `index.css`: the `.pwa-install-banner` styles from Section 5.8, including the `--home` variant and desktop media query

---

## 8. Post-Implementation Verification Checklist

### Low Battery Indicator

| #   | Test                                                                                                                                                       | Expected                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| B1  | `npm test` passes                                                                                                                                          | All normalizer tests pass including new `lowBattery` test                       |
| B2  | Chrome Android, battery > 25%                                                                                                                              | No amber banner, no 🪫 in ETAPanel                                              |
| B3  | DevTools console: `navigator.getBattery().then(b => { Object.defineProperty(b, 'level', {get: () => 0.15}); b.dispatchEvent(new Event('levelchange')); })` | Amber banner appears with "Battery low (15%)" message                           |
| B4  | Simulate charging = true                                                                                                                                   | Banner disappears; 🪫 clears in ETAPanel                                        |
| B5  | Battery at 22% (between trigger and clear)                                                                                                                 | If currently low → stays low (hysteresis). If currently not low → stays not low |
| B6  | Safari iOS                                                                                                                                                 | No banner, no errors, no 🪫 (complete no-op)                                    |
| B7  | Firefox                                                                                                                                                    | No banner, no errors, no 🪫 (complete no-op)                                    |
| B8  | Second participant views low-battery user in ETAPanel                                                                                                      | 🪫 badge visible next to their name                                             |
| B9  | Low-battery user leaves session                                                                                                                            | `lowBattery: false` written on unmount; 🪫 disappears for others                |
| B10 | Legacy participant (no `lowBattery` in Firebase)                                                                                                           | `normalizeParticipant` defaults to `false` — no icon                            |

### Context-Sensitive Help

| #   | Test                                                | Expected                                              |
| --- | --------------------------------------------------- | ----------------------------------------------------- |
| H1  | Join active session, location ready, wait 3s        | "I'm Leaving Now" glows with box-shadow pulse         |
| H2  | Pulse runs ~5.4s (3 × 1.8s) then stops              | Animation ends naturally                              |
| H3  | "Tap to share your arrival time" hint text appears  | Visible below button, fades in                        |
| H4  | Tap "I'm Leaving Now" during pulse                  | Pulse stops immediately, hint disappears, trip starts |
| H5  | Refresh same session (same tab or new tab)          | Pulse does NOT repeat (sessionStorage flag)           |
| H6  | First-ever active session: wait 2s after join       | "Keep this tab open for live updates" toast appears   |
| H7  | Toast auto-dismisses after 8s                       | Toast gone                                            |
| H8  | Open a different session                            | Toast does NOT appear again (localStorage flag)       |
| H9  | Host creates session, 0 other participants, wait 5s | Share button bounces once                             |
| H10 | Session with 2+ participants                        | Share button does NOT bounce                          |
| H11 | Start trip, panel in peek, en-route, wait 5s        | Drag handle bounces up once                           |
| H12 | Expand panel, collapse back                         | Drag handle does NOT bounce again                     |
| H13 | OS → "Reduce motion" accessibility setting          | NO animations play at all                             |
| H14 | Haptic on active session mount (Android Chrome)     | Light vibration on first render                       |
| H15 | Haptic on iOS Safari                                | No vibration (existing no-op), no errors              |

### PWA Installation

| #   | Test                                               | Expected                                                                  |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| P1  | `npm run build` succeeds                           | No errors                                                                 |
| P2  | `dist/manifest.json` exists and is valid JSON      | Contains name, icons, display                                             |
| P3  | `dist/sw.js` exists                                | File present                                                              |
| P4  | `dist/icons/` contains 3 PNGs                      | Correct dimensions (192, 512, 180)                                        |
| P5  | DevTools → Application → Manifest                  | All fields load, icons display correctly                                  |
| P6  | DevTools → Application → Service Workers           | SW registered, status "activated", no errors                              |
| P7  | DevTools → Application → Cache Storage             | `almost-there-shell-v1` with `/`, manifest, icons                         |
| P8  | Chrome Android: visit site                         | Install banner appears on both Home and Session pages                     |
| P9  | Tap "Install" from banner                          | App installs to home screen, banner disappears                            |
| P10 | Tap "✕" dismiss → navigate between pages → refresh | Banner does NOT reappear anywhere (localStorage flag)                     |
| P11 | Launch installed PWA from home screen              | Standalone mode (no browser chrome), correct splash screen                |
| P12 | Safari iOS → Share → Add to Home Screen            | Correct icon, launches fullscreen with dark status bar                    |
| P13 | Firefox desktop                                    | No install banner (graceful no-op), no errors                             |
| P14 | Airplane mode → launch PWA from home screen        | App shell loads from cache; map/Firebase show existing offline banners    |
| P15 | Deploy new version → reload in browser             | New SW activates, old `almost-there-shell-v1` cache refreshed             |
| P16 | `firebase deploy` → verify `sw.js` response header | `Cache-Control: no-cache, no-store, must-revalidate`                      |
| P17 | Lighthouse PWA audit                               | Score 100 on installability                                               |
| P18 | Verify `.session-header` padding                   | `padding-top: env(safe-area-inset-top)` present (for `black-translucent`) |

---

## Appendix: Complete File Change Map

| File                                | Feature              | Action                                                |
| ----------------------------------- | -------------------- | ----------------------------------------------------- |
| `src/config/constants.js`           | Battery              | Edit — 2 constants                                    |
| `src/hooks/useBattery.js`           | Battery              | **Create**                                            |
| `src/utils/normalizers.js`          | Battery              | Edit — 1 line                                         |
| `src/utils/normalizers.test.js`     | Battery              | Edit — 1 test                                         |
| `src/pages/Session.jsx`             | Battery + Help + PWA | Edit — banner + 5 micro-interactions + install banner |
| `src/components/ETAPanel.jsx`       | Battery + Help       | Edit — 🪫 badge + peek hint                           |
| `src/index.css`                     | Battery + Help + PWA | Edit — banner styles + 4 keyframes + install banner   |
| `public/manifest.json`              | PWA                  | **Create**                                            |
| `public/icons/icon-192.png`         | PWA                  | **Create**                                            |
| `public/icons/icon-512.png`         | PWA                  | **Create**                                            |
| `public/icons/apple-touch-icon.png` | PWA                  | **Create**                                            |
| `public/sw.js`                      | PWA                  | **Create**                                            |
| `index.html`                        | PWA                  | Edit — meta tags + SW registration                    |
| `firebase.json`                     | PWA                  | Edit — cache headers                                  |
| `src/hooks/useInstallPrompt.js`     | PWA                  | **Create**                                            |
| `src/pages/Home.jsx`                | PWA                  | Edit — install banner                                 |

**Total: 16 files (6 new, 10 modified)**
