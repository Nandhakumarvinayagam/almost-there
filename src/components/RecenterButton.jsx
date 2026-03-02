/**
 * Floating button with two modes:
 *
 * "overview"  (default) — crosshair icon. Tapping switches to "follow-me".
 * "follow-me"           — filled navigation arrow; button highlighted.
 *                         Tapping returns to overview (fitBounds all active).
 *
 * The parent (Session.jsx) owns `mode` state and the actual map operations
 * (fitBounds / panTo) so this component stays presentational.
 */
export default function RecenterButton({ mode = 'overview', onModeToggle }) {
  const isFollowMe = mode === 'follow-me';

  return (
    <button
      className={`recenter-btn${isFollowMe ? ' recenter-btn-follow' : ''}`}
      onClick={onModeToggle}
      aria-label={isFollowMe ? 'Switch to overview mode' : 'Follow my location on map'}
      title={isFollowMe ? 'Overview' : 'Follow me'}
    >
      {isFollowMe ? <FollowMeIcon /> : <CrosshairIcon />}
    </button>
  );
}

/** Crosshair — shown in "overview" mode */
function CrosshairIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="2" />
      <line x1="10" y1="1"    x2="10" y2="5.5"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="14.5" x2="10" y2="19"   stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="1"  y1="10"   x2="5.5" y2="10"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="14.5" y1="10" x2="19"  y2="10"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Solid navigation arrow — shown in "follow-me" mode */
function FollowMeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2L2 22l10-5 10 5L12 2z" />
    </svg>
  );
}
