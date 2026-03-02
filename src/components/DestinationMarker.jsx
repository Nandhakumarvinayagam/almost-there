import { OverlayView } from '@react-google-maps/api';
import MatIcon from './MatIcon';

const EMOJI_SIZE = 36; // rendered font-size in px

// Anchor the bottom-center of the 📍 emoji on the coordinate.
// The pin tip of 📍 is at the bottom-center, so:
//   x: -half-width → center horizontally
//   y: -full-height → bottom edge at the coordinate
// Using fixed values avoids the measured-dimension timing issue.
function getPixelPositionOffset() {
  return {
    x: -(EMOJI_SIZE / 2),
    y: -EMOJI_SIZE,
  };
}

export default function DestinationMarker({ destination }) {
  if (!destination) return null;

  return (
    <OverlayView
      position={{ lat: destination.lat, lng: destination.lng }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={getPixelPositionOffset}
    >
      <div
        className="dest-marker"
        aria-label={destination.name || 'Destination'}
        style={{
          lineHeight: 1,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        <MatIcon name="location_on" size={28} fill style={{ color: '#EA4335' }} />
      </div>
    </OverlayView>
  );
}
