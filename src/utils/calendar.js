/**
 * Calendar export utilities for Almost There.
 *
 * Provides:
 *   generateGoogleCalendarURL – deep-link to Google Calendar "create event"
 *   generateICSBlob           – downloadable .ics file (RFC 5545)
 */

/**
 * Format a timestamp (ms) as YYYYMMDDTHHMMSSZ (UTC)
 * as required by iCalendar and Google Calendar.
 */
function toUTCString(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters for iCalendar TEXT properties (RFC 5545 §3.3.11).
 * Order matters: backslash must be escaped first.
 */
function escapeICS(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

/**
 * Fold a single iCalendar content line at 75 octets (bytes) per RFC 5545 §3.1.
 * Continuation lines are prefixed with a single SPACE character (1 octet).
 * The returned string uses CRLF line endings between folded segments.
 */
function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const segments = [];
  let chunk = '';
  let chunkBytes = 0;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (chunkBytes + charBytes > 75) {
      segments.push(chunk);
      // Continuation line: leading SPACE counts as 1 octet toward the 75-octet limit
      chunk = ' ' + char;
      chunkBytes = 1 + charBytes;
    } else {
      chunk += char;
      chunkBytes += charBytes;
    }
  }
  if (chunk) segments.push(chunk);

  return segments.join('\r\n');
}

/**
 * Returns a Google Calendar "create event" URL pre-filled with the meetup details.
 *
 * The total URL length is kept strictly under 1800 characters to avoid browser
 * URL limits. If the description would push the URL over that threshold it is
 * truncated from the end (one character at a time) until it fits.
 *
 * @param {object} params
 * @param {string}  params.title          - Event title (e.g. "Meetup at Times Square")
 * @param {number}  params.startTime      - Start timestamp in ms
 * @param {number}  [params.endTime]      - End timestamp in ms; defaults to startTime + 1 hour
 * @param {string}  [params.location]     - Human-readable address or place name
 * @param {string}  [params.description]  - Optional session notes
 * @param {string}  [params.sessionURL]   - Session link appended to the description
 * @returns {string} Google Calendar template URL
 */
export function generateGoogleCalendarURL({
  title,
  startTime,
  endTime,
  location,
  description,
  sessionURL,
}) {
  const start = toUTCString(startTime);
  const end   = toUTCString(endTime ?? startTime + 3_600_000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text:   title,
    dates:  `${start}/${end}`,
  });
  if (location) params.set('location', location);

  const base = `https://calendar.google.com/calendar/render?${params.toString()}`;

  // Build description: optional notes + blank line + session link
  let desc = '';
  if (description) desc += description;
  if (sessionURL) {
    if (desc) desc += '\n\n';
    desc += sessionURL;
  }

  if (!desc) return base;

  // Append &details= only if it fits within the 1800-character budget
  const prefix = `${base}&details=`;
  let d = desc;
  while (d.length > 0 && prefix.length + encodeURIComponent(d).length >= 1800) {
    d = d.slice(0, d.length - 1);
  }

  return d.length > 0 ? `${prefix}${encodeURIComponent(d)}` : base;
}

/**
 * Returns an iCalendar (.ics) Blob for a single meetup event.
 *
 * Conforms to RFC 5545. Includes a 30-minute VALARM display reminder.
 * All lines are folded at 75 octets with CRLF line endings.
 *
 * @param {object} params
 * @param {string}  params.title          - Event summary
 * @param {number}  params.startTime      - Start timestamp in ms
 * @param {number}  [params.endTime]      - End timestamp in ms; defaults to startTime + 1 hour
 * @param {string}  [params.location]     - Human-readable address or place name
 * @param {string}  [params.description]  - Optional session notes
 * @param {string}  [params.sessionURL]   - Session link (written to URL property and appended
 *                                          to DESCRIPTION)
 * @returns {Blob} iCalendar blob with MIME type 'text/calendar;charset=utf-8'
 */
export function generateICSBlob({
  title,
  startTime,
  endTime,
  location,
  description,
  sessionURL,
}) {
  const start  = toUTCString(startTime);
  const end    = toUTCString(endTime ?? startTime + 3_600_000);
  const dtstamp = toUTCString(Date.now());

  // UID: derive a stable, globally-unique identifier from the session code + start time
  const sessionCode = sessionURL ? sessionURL.split('/').pop() : String(Date.now());
  const uid = `${startTime}-${sessionCode}@almost-there.app`;

  // Build DESCRIPTION: optional notes + blank line + session link
  const descParts = [];
  if (description) descParts.push(description);
  if (sessionURL)  descParts.push(sessionURL);
  const descValue = descParts.join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Almost There//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(title)}`,
  ];

  if (location)  lines.push(`LOCATION:${escapeICS(location)}`);
  if (descValue) lines.push(`DESCRIPTION:${escapeICS(descValue)}`);
  if (sessionURL) lines.push(`URL:${sessionURL}`);

  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Time to head out!',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );

  // Apply RFC 5545 line folding to every line; join with CRLF and terminate
  const content = lines.map(foldLine).join('\r\n') + '\r\n';
  return new Blob([content], { type: 'text/calendar;charset=utf-8' });
}
