/**
 * Returns a deep-link URL that opens the destination in the platform's
 * preferred navigation app.
 *
 * - iOS (iPhone / iPad / iPod): Apple Maps URL scheme.
 *   Apple Maps has no bicycle mode — BICYCLING falls back to walking.
 * - All other platforms (Android, desktop): Google Maps URL.
 *
 * @param {number} lat - Destination latitude
 * @param {number} lng - Destination longitude
 * @param {'DRIVING'|'BICYCLING'|'TRANSIT'|'WALKING'} [travelMode]
 * @returns {string} URL safe to pass to window.open()
 */
export function getNavigationURL(lat, lng, travelMode) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    // dirflg: d = driving, w = walking, r = transit
    // Apple Maps has no bicycle mode — fall back to walking.
    const dirflgMap = {
      DRIVING:   'd',
      WALKING:   'w',
      TRANSIT:   'r',
      BICYCLING: 'w',
    };
    const dirflg = dirflgMap[travelMode] ?? 'd';
    return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=${dirflg}`;
  }

  // Google Maps — works on Android, desktop, and as a web fallback on iOS
  const travelmodeMap = {
    DRIVING:   'driving',
    WALKING:   'walking',
    TRANSIT:   'transit',
    BICYCLING: 'bicycling',
  };
  const travelmode = travelmodeMap[travelMode] ?? 'driving';
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${travelmode}`;
}
