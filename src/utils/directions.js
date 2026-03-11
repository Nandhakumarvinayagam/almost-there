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
 * @param {{ lat: number, lng: number }[]} [waypoints=[]] — optional intermediate stops (max 3)
 * @returns {Promise<{ eta: number, routePolyline: string, transitArrivalTime: number|null, transitInfo: object|null }>}
 * @throws if the API returns a non-OK status; err.code === 'ZERO_RESULTS' for no-route cases
 */
export function getETAWithRoute(origin, destination, travelMode = "DRIVING", waypoints = []) {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DirectionsService();
    const request = {
      origin: new window.google.maps.LatLng(origin.lat, origin.lng),
      destination: new window.google.maps.LatLng(
        destination.lat,
        destination.lng,
      ),
      travelMode: window.google.maps.TravelMode[travelMode],
    };

    // Add waypoints if provided (stopover = true preserves user's stop order)
    if (waypoints.length > 0) {
      request.waypoints = waypoints.map((wp) => ({
        location: new window.google.maps.LatLng(wp.lat, wp.lng),
        stopover: true,
      }));
      request.optimizeWaypoints = false;
    }

    service.route(request, (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          const legs = result.routes[0].legs;
          const lastLeg = legs[legs.length - 1];

          // Sum duration and distance across all legs (waypoints create multiple legs)
          const totalEta = legs.reduce((sum, leg) => sum + leg.duration.value, 0);
          const totalDistanceMeters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);

          // Format total distance text
          const totalMiles = totalDistanceMeters / 1609.34;
          const totalKm = totalDistanceMeters / 1000;
          const routeDistance = totalMiles >= 0.1
            ? `${totalMiles.toFixed(1)} mi`
            : `${totalKm.toFixed(1)} km`;

          // Transit: use the API's scheduled arrival timestamp from the last leg.
          const transitArrivalTime =
            travelMode === "TRANSIT" && lastLeg.arrival_time
              ? lastLeg.arrival_time.value.getTime()
              : null;

          // Transit: extract first transit leg's line + vehicle details
          let transitInfo = null;
          if (travelMode === "TRANSIT") {
            for (const leg of legs) {
              const step = leg.steps?.find((s) => s.travel_mode === "TRANSIT");
              if (step?.transit) {
                transitInfo = {
                  line:
                    step.transit.line?.short_name ||
                    step.transit.line?.name ||
                    null,
                  vehicleType: step.transit.vehicle?.type || null,
                  departureStop: step.transit.departure_stop?.name || null,
                };
                break;
              }
            }
          }

          resolve({
            eta: totalEta, // seconds (sum of all legs)
            routePolyline: result.routes[0].overview_polyline, // encoded string (covers all legs)
            routeDistance,
            routeDistanceMeters: totalDistanceMeters,
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
