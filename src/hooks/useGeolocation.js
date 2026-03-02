import { useEffect, useRef } from "react";
import {
  LOCATION_UPDATE_INTERVAL,
  OFF_ROUTE_THRESHOLD_METERS,
  ARRIVED_METERS,
  ALMOST_THERE_MULTIPLIER,
} from "../config/constants";
import { haversineDistance, decodePolyline, isOffRoute } from "../utils/geo";

/**
 * Wraps navigator.geolocation.watchPosition with:
 * - Throttled Firebase writes (every LOCATION_UPDATE_INTERVAL ms)
 * - Arrival detection on EVERY GPS ping (not throttled) — fires onAlmostThere
 *   once when within almostThereThreshold, then onArrival once within arrivedThreshold.
 * - Off-route detection: fires onOffRoute once per route when the user strays
 *   > OFF_ROUTE_THRESHOLD_METERS. Resets automatically on new polyline.
 * - Proper cleanup (clearWatch on unmount / active change)
 *
 * All callbacks and frequently-changing values are kept in refs so the
 * watchPosition effect only restarts when active or participantId changes.
 *
 * @param {object}        opts
 * @param {boolean}       opts.active           Only start watching when true
 * @param {string}        opts.participantId    Dep to restart watch on identity change
 * @param {{lat,lng}|null} opts.destination     Meetup destination for arrival detection
 * @param {string|null}   opts.routePolyline    Encoded route polyline from Firebase
 * @param {number|null}   opts.arrivalRadius    Arrived threshold (m); derived almost-there = min(radius*3, 1000)
 * @param {function}      opts.onUpdate         ({lat,lng}) → void, throttled
 * @param {function}      opts.onAlmostThere    () → void, fired once on crossing almost-there threshold
 * @param {function}      opts.onArrival        () → void, fired once on crossing arrived threshold
 * @param {function}      opts.onOffRoute       ({lat,lng}) → void, fired once per route
 * @param {function}      opts.onError          ('denied'|'unavailable'|'timeout') → void
 */
export function useGeolocation({
  active,
  participantId,
  destination,
  routePolyline,
  arrivalRadius,
  onUpdate,
  onAlmostThere,
  onArrival,
  onOffRoute,
  onError,
}) {
  // Refs for callbacks and values — kept fresh each render without restarting effect
  const onUpdateRef = useRef(onUpdate);
  const onAlmostThereRef = useRef(onAlmostThere);
  const onArrivalRef = useRef(onArrival);
  const onOffRouteRef = useRef(onOffRoute);
  const onErrorRef = useRef(onError);
  const destinationRef = useRef(destination);
  const routePolylineRef = useRef(routePolyline);
  const arrivalRadiusRef = useRef(arrivalRadius);

  onUpdateRef.current = onUpdate;
  onAlmostThereRef.current = onAlmostThere;
  onArrivalRef.current = onArrival;
  onOffRouteRef.current = onOffRoute;
  onErrorRef.current = onError;
  destinationRef.current = destination;
  routePolylineRef.current = routePolyline;
  arrivalRadiusRef.current = arrivalRadius;

  // Throttle: timestamp of last Firebase location write
  const lastWriteRef = useRef(0);

  // Arrival: fire each milestone only once per watch session
  const almostTheredFiredRef = useRef(false);
  const arrivedFiredRef = useRef(false);

  // Off-route: cache decoded polyline points; reset cooldown on new polyline
  const cachedRouteRef = useRef({ encoded: null, points: [] });
  const offRouteFiredRef = useRef(false);

  useEffect(() => {
    if (!active || !participantId) return;

    if (!navigator.geolocation) {
      onErrorRef.current?.("unavailable");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const currentPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        // ---- Arrival detection (runs on EVERY update — not throttled) ----
        const dest = destinationRef.current;
        if (dest) {
          const dist = haversineDistance(currentPos, dest);
          const arrivedThreshold = arrivalRadiusRef.current ?? ARRIVED_METERS;
          const almostThereThreshold = Math.min(
            arrivedThreshold * ALMOST_THERE_MULTIPLIER,
            1000,
          );

          if (!arrivedFiredRef.current && dist <= arrivedThreshold) {
            arrivedFiredRef.current = true;
            almostTheredFiredRef.current = true; // skip almost-there if already arrived
            onArrivalRef.current?.();
          } else if (
            !almostTheredFiredRef.current &&
            dist <= almostThereThreshold
          ) {
            almostTheredFiredRef.current = true;
            onAlmostThereRef.current?.();
          }
        }

        // ---- Throttle: only write location to Firebase every 10 s ----
        if (now - lastWriteRef.current < LOCATION_UPDATE_INTERVAL) return;
        lastWriteRef.current = now;

        onUpdateRef.current?.(currentPos);

        // ---- Off-route check (runs at throttled rate — sufficient for nav) ----
        const encoded = routePolylineRef.current;
        if (encoded && onOffRouteRef.current) {
          if (cachedRouteRef.current.encoded !== encoded) {
            cachedRouteRef.current = {
              encoded,
              points: decodePolyline(encoded),
            };
            offRouteFiredRef.current = false; // new route → reset cooldown
          }

          if (
            !offRouteFiredRef.current &&
            isOffRoute(
              currentPos,
              cachedRouteRef.current.points,
              OFF_ROUTE_THRESHOLD_METERS,
            )
          ) {
            offRouteFiredRef.current = true;
            onOffRouteRef.current(currentPos);
          }
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onErrorRef.current?.("denied");
        } else if (err.code === err.TIMEOUT) {
          onErrorRef.current?.("timeout");
        }
        // POSITION_UNAVAILABLE — silently ignore, watchPosition will retry
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      },
    );

    // CRITICAL: always clear the watch on unmount or when active/participantId changes
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active, participantId]);
}
