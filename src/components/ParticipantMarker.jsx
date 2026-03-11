import { OverlayView } from '@react-google-maps/api';
import { STALE_THRESHOLD, STATUS } from '../config/constants';
import { getParticipantColor } from '../utils/participantColor';
import { useNow } from '../hooks/useNow';
import MatIcon from './MatIcon';
import { timeAgo } from '../utils/formatters';
import { AvatarIcon } from './Avatars';

const DOT_SIZE = 36; // width and height of the dot circle

// Backward-compat: legacy data stored Material icon names (e.g. "coffee");
// newer data stores actual emoji chars (e.g. "☕"). Map old → new for display.
const ICON_TO_EMOJI = { coffee: '☕', local_gas_station: '⛽', local_parking: '🅿️', traffic: '🚦', sprint: '🏃', shopping_cart: '🛒' };

// Anchor the dot's centre exactly on the coordinate using fixed pixel values.
// The container div is always DOT_SIZE × DOT_SIZE; the bubble is absolutely
// positioned above it via CSS, so we never need to measure a dynamic height.
function getPixelPositionOffset() {
  return {
    x: -(DOT_SIZE / 2),
    y: -(DOT_SIZE / 2),
  };
}

export default function ParticipantMarker({
  participant,    // { name, location: {lat,lng}, lastUpdated, status }
  index,          // stable numeric index — drives colour assignment
  isCurrentUser,  // boolean
  isHost,         // boolean — renders a subtle "Host" tag below the name bubble
  nudgeLabelDown, // boolean — push name bubble down 20px to avoid overlap with a nearby marker
}) {
  const now = useNow(10000);
  if (!participant.location) return null;

  const isPaused  = participant.status === STATUS.PAUSED;
  // ⚠️ CRITICAL: skip stale check for paused users — their location intentionally
  // stopped updating. Without this guard they'd show BOTH the paused opacity AND
  // the stale dashed-border + clock icon, which is confusing and wrong.
  const isStale   = !isPaused && (now - participant.lastUpdated > STALE_THRESHOLD);
  const arrived   = participant.status === STATUS.ARRIVED;
  const color     = getParticipantColor(participant, index);
  const initial   = participant.name?.[0]?.toUpperCase() ?? '?';
  const position  = { lat: participant.location.lat, lng: participant.location.lng };

  const almostThere = participant.status === STATUS.ALMOST_THERE;

  const hasAvatar = participant.avatarId != null;

  const dotClasses = [
    'p-marker-dot',
    hasAvatar   ? 'p-marker-dot-avatar'       : '',
    isStale     ? 'p-marker-dot-stale'        : '',
    arrived     ? 'p-marker-dot-arrived'      : '',
    almostThere ? 'p-marker-dot-almost-there' : '',
  ].filter(Boolean).join(' ');

  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={getPixelPositionOffset}
    >
      {/* Container is exactly DOT_SIZE × DOT_SIZE so the offset always centres
          the dot on the coordinate. Bubble is absolutely positioned above via CSS.
          Current user gets a higher z-index so their pin renders on top of overlapping pins. */}
      <div
        className={[
          'p-marker',
          isStale      ? 'p-marker-stale'  : '',
          isPaused     ? 'p-marker-paused' : '',
        ].filter(Boolean).join(' ')}
        style={isCurrentUser ? { zIndex: 10 } : undefined}
      >
        {/* Name bubble — absolutely positioned above the dot.
            When nudgeLabelDown is true (another marker is within ~50 m at a lower index)
            shift the bubble down to prevent overlap without relying on DOM measurements. */}
        <div
          className="p-marker-bubble"
          style={nudgeLabelDown ? { transform: 'translateX(-50%) translateY(20px)' } : undefined}
        >
          <span className="p-marker-name">
            {participant.name}
            {isCurrentUser ? ' (you)' : ''}
          </span>
          {/* Paused label — shown instead of stale label (the two are mutually exclusive) */}
          {isPaused && (
            <span className="p-marker-paused-label">location paused</span>
          )}
          {isStale && (
            <span className="p-marker-stale-label">
              {timeAgo(participant.lastUpdated, now)}
            </span>
          )}
          {isHost && (
            <span className="p-marker-host-label">Host</span>
          )}
        </div>

        {/* 36px circle dot with avatar or initial letter.
            Avatar mode: no colored background (emoji has its own intrinsic colors).
            Initial mode: colored circle with white letter as before. */}
        <div className={dotClasses} style={hasAvatar ? undefined : { background: color }}>
          {hasAvatar
            ? <AvatarIcon avatarId={participant.avatarId} size={28} />
            : <span className="p-marker-initial">{initial}</span>
          }
          {arrived && <MatIcon name="check_circle" size={16} fill className="p-marker-check" />}
          {/* Pause icon overlay — centered on dot, white, distinct from stale dashed border */}
          {isPaused && <MatIcon name="pause_circle" size={16} className="p-marker-pause-icon" />}
        </div>

        {/* Status emoji badge — floats below the dot; rendered as raw emoji for reliability */}
        {participant.statusEmoji?.trim() && (() => {
          const displayEmoji = ICON_TO_EMOJI[participant.statusEmoji] || participant.statusEmoji;
          return (
            <div className="p-marker-emoji-badge" aria-label={`Status: ${displayEmoji}`}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>{displayEmoji}</span>
            </div>
          );
        })()}
      </div>
    </OverlayView>
  );
}
