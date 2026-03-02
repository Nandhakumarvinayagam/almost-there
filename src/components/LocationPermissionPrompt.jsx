/**
 * Bottom-sheet dialog for location permission states.
 *
 * state: 'pre-ask'    — shown before the browser permission dialog fires,
 *                        explaining why we need location.
 *        'denied'     — shown after the user has blocked location access.
 *        'unavailable'— shown when the browser/device has no geolocation API.
 *
 * Props:
 *   onRequestPermission — called when user confirms the pre-ask (triggers
 *                          getCurrentPosition which shows the native dialog).
 *   onDismiss           — called for "Not now" / "Dismiss" / "OK".
 */
import MatIcon from './MatIcon';

export default function LocationPermissionPrompt({ state, onRequestPermission, onDismiss }) {
  const content = {
    'pre-ask': {
      icon: 'location_on',
      title: 'Location needed',
      body: 'We need your location so friends can see where you are on the map. Tap "Enable" and then Allow when your browser asks.',
    },
    'denied': {
      icon: 'location_off',
      title: 'Location blocked',
      body: 'Location access was denied. Open your browser settings, allow location for this site, then reload the page.',
    },
    'unavailable': {
      icon: 'gps_off',
      title: 'Location unavailable',
      body: "Your browser doesn't support location services. Others can still see their own ETAs but won't see your position.",
    },
  }[state] ?? {};

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={content.title}>
      <div className="prompt-card">
        <div className="loc-prompt-icon" aria-hidden="true">{content.icon && <MatIcon name={content.icon} size={40} />}</div>
        <h3>{content.title}</h3>
        <p className="prompt-subtitle">{content.body}</p>

        <div className="prompt-actions">
          {state === 'pre-ask' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onDismiss}>
                Not now
              </button>
              <button type="button" className="btn btn-primary" onClick={onRequestPermission}>
                Enable
              </button>
            </>
          )}
          {state === 'denied' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onDismiss}>
                Dismiss
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            </>
          )}
          {state === 'unavailable' && (
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={onDismiss}
            >
              OK, got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
