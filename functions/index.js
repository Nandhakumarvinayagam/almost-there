'use strict';

/**
 * Firebase Cloud Function: sessionPreview
 *
 * Intercepts GET /session/{id} requests. For known crawlers (Facebook,
 * Twitter/X, WhatsApp, Slack, LinkedIn, Google), reads session data from
 * RTDB and returns an HTML page with per-session Open Graph meta tags so
 * that link previews show the event title, going count, and a cover image.
 *
 * For all other visitors the function returns the built SPA index.html,
 * which is copied from dist/ into this directory as part of the deploy step:
 *   npm run build && cp dist/index.html functions/index.html
 *
 * Deployed as a 1st-gen Cloud Function — compatible with the Firebase
 * Spark (free) plan.
 *
 * Reference: Social Edition Plan v5, Section 19 (Phase 4, Step 5).
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp();

// ---------------------------------------------------------------------------
// Crawler detection
// ---------------------------------------------------------------------------

const CRAWLER_PATTERNS = [
  'facebookexternalhit',
  'Twitterbot',
  'WhatsApp',
  'Slackbot',
  'LinkedInBot',
  'Googlebot',
];

function isCrawler(userAgent) {
  if (!userAgent) return false;
  return CRAWLER_PATTERNS.some((pattern) => userAgent.includes(pattern));
}

// ---------------------------------------------------------------------------
// SPA HTML — loaded once at cold-start and cached across warm invocations.
// Populated by: npm run build && cp dist/index.html functions/index.html
// ---------------------------------------------------------------------------

let spaHtml;
try {
  spaHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
} catch {
  // Placeholder shown until first build+copy step populates index.html
  spaHtml =
    '<!DOCTYPE html><html><head><title>Almost There</title>' +
    '<meta http-equiv="refresh" content="5" /></head>' +
    '<body><p>Almost There is loading… please refresh in a moment.</p></body></html>';
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

exports.sessionPreview = functions.https.onRequest(async (req, res) => {
  const ua = req.headers['user-agent'] || '';

  // Extract the session ID from /session/{id} (case-insensitive, stops at /, ?, #)
  const match = req.path.match(/^\/session\/([^/?&#]+)/i);

  // Non-crawler or path doesn't match → serve the SPA
  if (!isCrawler(ua) || !match) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.status(200).type('html').send(spaHtml);
  }

  const sessionId = match[1].toUpperCase();

  try {
    const db = admin.database();
    const snap = await db.ref(`sessions/${sessionId}`).once('value');
    const session = snap.val();

    // Session not found → fall back to SPA (client will show 404 state)
    if (!session) {
      return res.status(200).type('html').send(spaHtml);
    }

    // --- Build OG metadata ---

    const emoji = session.theme?.emoji || '📍';
    // Social Edition uses `title`; legacy sessions use `nickname`
    const title = session.title || session.nickname || 'Almost There';
    const ogTitle = `${emoji} ${title}`;

    // Prefer the denormalized headcount; fall back to counting participants
    let goingCount =
      typeof session.headcount === 'number' ? session.headcount : null;

    if (goingCount === null && session.participants) {
      goingCount = Object.values(session.participants).filter((p) => {
        return (p.rsvpStatus || 'going') === 'going';
      }).length;
    }

    const peopleStr =
      goingCount != null && goingCount > 0
        ? `${goingCount} ${goingCount === 1 ? 'person' : 'people'} going · `
        : '';
    const ogDescription = `${peopleStr}RSVP now!`;

    // Use the request hostname so this works with any custom domain
    const appUrl = `https://${req.hostname}`;
    const sessionUrl = `${appUrl}/session/${sessionId}`;
    // og-image.png is in public/ and deployed to the hosting root
    const ogImageUrl = `${appUrl}/og-image.png`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(ogTitle)}</title>

  <!-- Open Graph -->
  <meta property="og:type"         content="website" />
  <meta property="og:url"          content="${escapeHtml(sessionUrl)}" />
  <meta property="og:title"        content="${escapeHtml(ogTitle)}" />
  <meta property="og:description"  content="${escapeHtml(ogDescription)}" />
  <meta property="og:image"        content="${escapeHtml(ogImageUrl)}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image"       content="${escapeHtml(ogImageUrl)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(sessionUrl)}">${escapeHtml(ogTitle)}</a>…</p>
</body>
</html>`;

    // Cache crawler responses for 60 s — long enough to avoid hammering RTDB
    // but short enough that session title/count changes are reflected quickly.
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).type('html').send(html);
  } catch (err) {
    functions.logger.error('sessionPreview: RTDB read failed', {
      sessionId,
      error: err.message,
    });
    // On any error, serve the SPA so the user still lands on a working page
    return res.status(200).type('html').send(spaHtml);
  }
});
