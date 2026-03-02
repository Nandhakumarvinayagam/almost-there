import { useMemo } from 'react';
import { Polyline } from '@react-google-maps/api';
import { STATUS } from '../config/constants';
import { decodePolyline } from '../utils/geo';
import { getParticipantColor } from '../utils/participantColor';

/**
 * Renders the stored Directions API route for one participant as a Polyline.
 * - Only shown for EN_ROUTE and ARRIVED participants with a stored polyline.
 * - Color is read from participant.colorIndex (via getParticipantColor) so it
 *   always matches the avatar and ETA panel dot — single source of truth.
 * - Arrived: faded to 0.2 opacity so it doesn't clutter the map.
 * - White outline rendered first (weight 6) for contrast on dark map tiles,
 *   with the participant-coloured line (weight 3) layered on top.
 * - No additional API calls — decodes the encoded string already in Firebase.
 */
export default function RoutePolyline({ participant, index }) {
  const { status, routePolyline } = participant;

  const arrived = status === STATUS.ARRIVED;
  const color   = getParticipantColor(participant, index);

  // Decode once per polyline string change — avoids O(n) work on every render.
  // Pass null-safe string so useMemo is always called (Rules of Hooks).
  const path = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline]
  );

  // White outline — rendered below the coloured line for contrast on dark tiles
  const outlineOptions = useMemo(
    () => ({
      strokeColor:   '#ffffff',
      strokeWeight:  6,
      strokeOpacity: arrived ? 0.10 : 0.45,
      clickable:     false,
      zIndex:        1,
    }),
    [arrived]
  );

  // Coloured line on top of the white outline
  const colorOptions = useMemo(
    () => ({
      strokeColor:   color,
      strokeWeight:  3,
      strokeOpacity: arrived ? 0.2 : 0.7,
      clickable:     false,
      zIndex:        2,
    }),
    [color, arrived]
  );

  // Skip participants who haven't started or have no stored route
  if (status === STATUS.NOT_STARTED || !routePolyline) return null;

  return (
    <>
      <Polyline path={path} options={outlineOptions} />
      <Polyline path={path} options={colorOptions} />
    </>
  );
}
