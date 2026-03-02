import { useToast } from '../hooks/useToast';
import { copyToClipboard } from '../utils/clipboard';
import { generateGoogleCalendarURL, generateICSBlob } from '../utils/calendar';
import Toast from './Toast';
import MatIcon from './MatIcon';

// ─── Shared helper ───────────────────────────────────────────────────────────
/**
 * Invoke the Web Share API on mobile, or copy the session URL to clipboard
 * on desktop / when Web Share is unavailable.
 *
 * @param {string}   sessionId   - 6-char session code
 * @param {string}   meetupName  - Nickname or destination name (may be falsy)
 * @param {object}   destination - { name, address } — used only for share text
 * @param {Function} showToast   - Toast callback (optional; no-op if omitted)
 */
export async function triggerShare(sessionId, meetupName, destination, showToast) {
  const url = `${window.location.origin}/session/${sessionId}`;
  const title = meetupName
    ? `${meetupName} — Almost There`
    : 'Almost There — Join my meetup';
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text: meetupName ? `Join '${meetupName}' on Almost There` : 'Join me on Almost There',
        url,
      });
      return;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }

  const clipboardText = meetupName
    ? `Join '${meetupName}' on Almost There: ${url}`
    : url;

  try {
    await copyToClipboard(clipboardText);
    showToast?.('Link copied!');
  } catch {
    window.prompt('Copy this link to share:', clipboardText);
  }
}


export default function ShareLink({ sessionId, nickname, session }) {
  const { toast, showToast } = useToast();

  const url = `${window.location.origin}/session/${sessionId}`;
  const shareTitle = nickname ? `${nickname} — Almost There` : 'Almost There — Join my meetup';
  const clipboardText = nickname ? `Join '${nickname}' on Almost There: ${url}` : url;

  async function handleShare() {
    // Native Web Share API — works great on mobile
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: nickname ? `Join '${nickname}' on Almost There` : 'Join me on Almost There',
          url,
        });
        return;
      } catch {
        // User cancelled — fall through to clipboard
      }
    }

    // Clipboard API with textarea fallback
    try {
      await copyToClipboard(clipboardText);
      showToast('Link copied!');
    } catch {
      // Last resort: browser prompt
      window.prompt('Copy this link to share:', clipboardText);
    }
  }

  async function handleCopyCode() {
    try {
      await copyToClipboard(sessionId);
      showToast('Code copied!');
    } catch {
      showToast("Couldn't copy");
    }
  }

  // ---- Calendar export (scheduled meetups) ----
  const scheduledTime = session?.scheduledTime;
  const calendarParams = scheduledTime ? {
    title: nickname
      ? `${nickname} — Almost There`
      : `Meetup at ${session?.destination?.name || session?.destination?.address || 'Destination'}`,
    startTime: scheduledTime,
    location: session?.destination?.address || session?.destination?.name,
    description: session?.notes || undefined,
    sessionURL: url,
  } : null;

  function handleGoogleCalendar() {
    if (!calendarParams) return;
    window.open(generateGoogleCalendarURL(calendarParams), '_blank', 'noopener,noreferrer');
  }

  function handleDownloadICS() {
    if (!calendarParams) return;
    const blob = generateICSBlob(calendarParams);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'meetup.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  return (
    <>
      <button
        className="btn btn-secondary btn-sm header-share-btn"
        onClick={handleShare}
        aria-label="Share session link"
      >
        <MatIcon name="share" size={20} />
        {/* Label hidden on <640px (icon-only), hidden entirely on <380px via CSS */}
        <span className="share-link-label">Share Link</span>
      </button>

      {/* Copy Code — compact button; complements the prominent chip in the header */}
      <button
        className="btn btn-secondary btn-sm share-code-btn"
        onClick={handleCopyCode}
        aria-label={`Copy session code ${sessionId}`}
        title={`Copy session code: ${sessionId}`}
      >
        <MatIcon name="content_copy" size={20} />
        <span className="share-code-label">Copy Code</span>
      </button>

      {/* Calendar export — shown whenever the meetup has a scheduled time,
          regardless of the current user's trip status (for inviting others). */}
      {scheduledTime && calendarParams && (
        <div className="share-calendar-export">
          <div className="share-calendar-btns">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleGoogleCalendar}
            >
              <MatIcon name="calendar_today" size={20} /> Add to Google Calendar
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadICS}
            >
              <MatIcon name="download" size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Download .ics
            </button>
          </div>
          <p className="share-calendar-helper">
            Calendar events won't update if meetup details change.
          </p>
        </div>
      )}

      <Toast message={toast} />
    </>
  );
}
