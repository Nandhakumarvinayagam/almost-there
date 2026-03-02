/**
 * Geospatial utilities used for off-route detection.
 * Kept separate from directions.js so they can be imported in
 * useGeolocation without pulling in Google Maps SDK types.
 */

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Haversine great-circle distance between two {lat, lng} points.
 * @returns {number} Distance in metres
 */
export function haversineDistance(pos1, pos2) {
  const R = 6_371_000;
  const dLat = toRad(pos2.lat - pos1.lat);
  const dLng = toRad(pos2.lng - pos1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Decodes a Google Maps encoded polyline string into an array of {lat, lng}.
 * Implements the standard polyline encoding algorithm.
 * @param {string} encoded
 * @returns {{ lat: number, lng: number }[]}
 */
export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Returns true if currentPos is further than thresholdMeters from every
 * point on the polyline — i.e. the user has left the planned route.
 *
 * @param {{ lat: number, lng: number }} currentPos
 * @param {{ lat: number, lng: number }[]} polylinePoints  decoded route points
 * @param {number} thresholdMeters
 * @returns {boolean}
 */
export function isOffRoute(currentPos, polylinePoints, thresholdMeters) {
  if (!polylinePoints.length) return false;
  let minDistance = Infinity;
  for (const point of polylinePoints) {
    const d = haversineDistance(currentPos, point);
    if (d < minDistance) minDistance = d;
    if (minDistance <= thresholdMeters) return false; // early exit
  }
  return minDistance > thresholdMeters;
}
