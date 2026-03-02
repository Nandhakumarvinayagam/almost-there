# Almost There — Claude Code Quick Start Guide

## Prerequisites

Before opening Claude Code, you'll need:

1. **Google Maps API Key**
   - Go to https://console.cloud.google.com
   - Create a new project (or use existing)
   - Enable these APIs: Maps JavaScript API, Places API, Directions API
   - Create an API key under Credentials
   - Restrict the key to your domain (optional for dev, recommended for prod)

2. **Firebase Project**
   - Go to https://console.firebase.google.com
   - Create a new project called "almost-there" (or similar)
   - Enable Realtime Database (start in test mode)
   - Go to Project Settings → Your Apps → Add Web App
   - Copy the config values (apiKey, authDomain, databaseURL, etc.)

3. **Node.js** (v18+) installed on your machine

## Getting Started with Claude Code

### Step 1: Create the project folder

```bash
mkdir almost-there
cd almost-there
```

### Step 2: Open Claude Code

```bash
claude
```

Claude Code will automatically read the `CLAUDE.md` file in the project root.
Copy the `CLAUDE.md` file from this download into your `almost-there/` folder before launching Claude Code.

### Step 3: Use these prompts in sequence

**Prompt 1 — Project Setup:**

```
Set up the project: Initialize a Vite + React app with React Router,
install Firebase SDK and @react-google-maps/api. Create the .env file
with placeholder values, the file structure from CLAUDE.md, and the
constants.js config file. Don't build any UI yet — just the skeleton.
```

**⚠️ PAUSE — Configure before continuing:**
Open the `.env` file and replace all placeholder values with your actual Google Maps and Firebase API keys. Then start your local dev server:

```bash
npm run dev
```

Keep it running — you'll test each prompt's output in the browser as you go. If you skip this, Prompts 2+ will produce code that crashes on load.

**Prompt 2 — Home + Create Pages:**

```
Build the Home page and Create page. Home should have "Create Meetup"
and "Join Meetup" (with a code input) buttons. Create page should show
a Google Map with Places Autocomplete search, let the user pick a
destination, and have a "Start Meetup" button that creates a session
in Firebase and generates a shareable link. Use the data model from CLAUDE.md.
```

**Prompt 3 — Session Page + Join Flow:**

```
Build the Session page. When someone navigates to /session/{id}, load
the session from Firebase, show the destination on the map, and prompt
them to enter their name (JoinPrompt component). After entering a name,
add them as a participant in Firebase with status "not-started" and no
location data. Generate a participant ID and store it in sessionStorage
so refreshes reconnect them. Show a prominent "I'm Leaving Now" button
after joining. Do NOT request location permission or start tracking yet.
```

**Prompt 4 — Live Location + Start Trip:**

```
Build the useGeolocation hook and the "Start Trip" flow. Location
sharing should NOT begin automatically — only when the user taps the
"I'm Leaving Now" button from Prompt 3.

When "I'm Leaving Now" is tapped:
1. Request location permission and start watchPosition with high accuracy
2. Throttle Firebase location writes to every 10 seconds
3. Update participant status from "not-started" to "en-route"

Show all participants as moving markers on the map with name labels.
Participants with status "not-started" should appear in the ETA panel
as "Hasn't left yet" with no marker on the map.

Dim markers that haven't updated in 30+ seconds. Build a useEffect
interval that checks Date.now() - participant.lastUpdated to toggle an
isStale visual state independently of Firebase updates. Show "last
updated X ago" on stale markers.
```

**Prompt 5 — ETA + Panel:**

```
Implement the ETA countdown strategy from CLAUDE.md.

1. Create utils/geo.js with a Haversine function that calculates
   distance in meters between two lat/lng points.

2. Create hooks/useCountdown.js — a hook that takes an
   expectedArrivalTime (absolute timestamp) and returns a live
   countdown string (e.g., "12 min") updating every second via
   setInterval. Return cleanup in useEffect.

3. Modify utils/directions.js to return both duration (seconds) AND
   overview_polyline from the Directions API response.

4. When a user starts sharing location, call the Directions API ONCE
   to get duration and polyline. Calculate expectedArrivalTime =
   Date.now() + (duration * 1000). Store expectedArrivalTime and
   routePolyline in Firebase — do NOT store raw ETA seconds.

5. Build a useEffect in useGeolocation that checks if the user is
   >500m off the stored polyline (using Haversine math from geo.js)
   to trigger a single recalculation. Also recalculate if 5 minutes
   have passed AND user moved >200m. Otherwise, rely on the countdown.

6. Build the ETAPanel component at the bottom of the Session page
   showing each participant's name, live countdown timer (using
   useCountdown), and status. Use the same participant colors that
   will be used for markers.

7. Ensure all useEffect hooks return proper cleanup functions.
```

**Prompt 6 — Share + Session Management:**

```
Add the ShareLink component (copy to clipboard + native Web Share API
if available). Add "End Meetup" button for the host. Add session expiry
check (2hr TTL). When session is completed or expired, stop location
sharing and show "Meetup ended" state.
```

**Prompt 7 — Polish:**

```
Make the app mobile-responsive and polished. Add loading states, error
handling for denied location permissions, offline/reconnection handling,
and the Screen Wake Lock API to keep the screen on during active sessions.
Make sure touch targets are at least 44px and the map is the hero element.
Ensure ALL useEffect hooks strictly return cleanup functions to clear
intervals, cancel watchPosition, and release the wakeLock when the
Session component unmounts — no memory leaks.
```

## After Building — Test Locally

```bash
npm run dev
```

Open in two browser tabs (or your phone + computer) to simulate two participants.

## After MVP — Enhancement Prompts

Once the base app is working, follow the prompts in `ENHANCEMENT_PLAN.md` in order:

1. Copy `ENHANCEMENT_PLAN.md` into your project root (alongside `CLAUDE.md`)
2. **Skip the Pre-Tier section** — the countdown ETA model and "not-started" status are already built into the MVP prompts above
3. Start directly with **Tier 1** (map bug fix, custom markers, arrival detection)
4. Then work through **Tier 2 → 3** sequentially
5. Each enhancement has a ready-to-paste Claude Code prompt

The Enhancement Plan also contains billing analysis, cost safety checklists, and guidance on which features to verify in Google Cloud Console before wide rollout.

## Deploy to Firebase Hosting

```bash
npm run build
firebase init hosting    # select your project, set public to "dist"
firebase deploy
```

Your app will be live at `https://your-project.web.app`

## ⚠️ Before Sharing Your Live URL

Once you deploy to Firebase Hosting and start sharing the link with friends, you MUST restrict your Google Maps API key to prevent abuse:

1. Go to https://console.cloud.google.com → Credentials
2. Click on your API key
3. Under **Application restrictions**, select "Websites"
4. Under **Website restrictions**, add:
   - `https://your-project.web.app/*` (your Firebase Hosting URL)
   - `http://localhost:*/*` (for local development)
5. Under **API restrictions**, select "Restrict key" and enable only:
   - Maps JavaScript API
   - Places API
   - Directions API
6. Click **Save**

Without these restrictions, anyone who inspects your page source can steal your API key and run up charges on your account.

## Tips

- You can update the `.env` file with your real API keys at any time
- Firebase test mode rules expire after 30 days — tighten them before sharing widely
- The Google Maps API key should be restricted to your Firebase hosting domain for production
- Test on mobile early — that's the primary use case
