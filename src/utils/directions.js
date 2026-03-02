/**
 * Google Directions API helper.
 *
 * Threshold logic (50 m / 2 min) lives in the caller (Session.jsx).
 * This module is responsible only for:
 *   1. Making the Directions API call via the already-loaded Maps JS SDK
 */

/**
 * Like getETA but also returns the route's overview_polyline for storage.
 * Used on the "Start Trip" action to capture the initial route in one API call.
 *
 * For TRANSIT mode, also returns:
 *   - transitArrivalTime: scheduled arrival timestamp in ms (use instead of
 *     computing Date.now() + eta * 1000, which ignores bus/train schedules)
 *   - transitInfo: { line, vehicleType, departureStop } — first transit leg details
 *
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @param {'DRIVING'|'BICYCLING'|'TRANSIT'|'WALKING'} [travelMode='DRIVING']
 * @returns {Promise<{ eta: number, routePolyline: string, transitArrivalTime: number|null, transitInfo: object|null }>}
 * @throws if the API returns a non-OK status; err.code === 'ZERO_RESULTS' for no-route cases
 */
export function getETAWithRoute(origin, destination, travelMode = "DRIVING") {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin: new window.google.maps.LatLng(origin.lat, origin.lng),
        destination: new window.google.maps.LatLng(
          destination.lat,
          destination.lng,
        ),
        travelMode: window.google.maps.TravelMode[travelMode],
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          const leg = result.routes[0].legs[0];

          // Transit: use the API's scheduled arrival timestamp directly.
          // The Maps JS SDK returns arrival_time.value as a JavaScript Date object
          // (unlike the REST API which returns seconds). Use .getTime() — which
          // already returns milliseconds — rather than multiplying by 1000, which
          // would produce a value 1000× too large.
          const transitArrivalTime =
            travelMode === "TRANSIT" && leg.arrival_time
              ? leg.arrival_time.value.getTime() // Date → ms (no * 1000)
              : null;

          // Transit: extract first transit leg's line + vehicle details
          let transitInfo = null;
          if (travelMode === "TRANSIT") {
            const step = leg.steps?.find((s) => s.travel_mode === "TRANSIT");
            if (step?.transit) {
              transitInfo = {
                line:
                  step.transit.line?.short_name ||
                  step.transit.line?.name ||
                  null,
                vehicleType: step.transit.vehicle?.type || null, // BUS, SUBWAY, RAIL, TRAM …
                departureStop: step.transit.departure_stop?.name || null,
              };
            }
          }

          resolve({
            eta: leg.duration.value, // seconds
            routePolyline: result.routes[0].overview_polyline, // encoded string
            // Distance from the first leg — text is a locale-aware display string
            // (e.g. "14.2 mi" or "22.8 km"); value is metres for future math.
            routeDistance: leg.distance?.text ?? null,
            routeDistanceMeters: leg.distance?.value ?? null,
            transitArrivalTime,
            transitInfo,
          });
        } else if (
          status === window.google.maps.DirectionsStatus.ZERO_RESULTS
        ) {
          const err = new Error(`No route found for mode: ${travelMode}`);
          err.code = "ZERO_RESULTS";
          reject(err);
        } else {
          reject(new Error(`Directions API: ${status}`));
        }
      },
    );
  });
}

/**
 * Call the Directions API and return travel duration in seconds.
 * Uses the Maps JS SDK (already loaded by @react-google-maps/api) so no
 * separate REST request or API key exposure is needed.
 *
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @returns {Promise<number>} Duration in seconds
 * @throws if the API returns a non-OK status
 */
export function getETA(origin, destination) {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin: new window.google.maps.LatLng(origin.lat, origin.lng),
        destination: new window.google.maps.LatLng(
          destination.lat,
          destination.lng,
        ),
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          resolve(result.routes[0].legs[0].duration.value); // seconds
        } else {
          reject(new Error(`Directions API: ${status}`));
        }
      },
    );
  });
}
