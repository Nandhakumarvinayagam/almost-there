/**
 * Single source of truth for participant colour resolution.
 *
 * Priority:
 *   1. participant.colorIndex (stored in Firebase on join — consistent for ALL clients)
 *   2. fallbackIndex (the iteration index passed by the caller — for old sessions
 *      that predate colour persistence)
 *
 * All three surfaces that need a colour (ParticipantMarker, RoutePolyline,
 * ETAPanel avatar/dot) must call this function instead of computing colours
 * independently, so updates automatically propagate everywhere.
 *
 * @param {object|null} participant - Firebase participant data object
 * @param {number} fallbackIndex   - array iteration index used when colorIndex absent
 * @returns {string} hex colour string from PARTICIPANT_COLORS
 */
import { PARTICIPANT_COLORS } from '../config/constants';

export function getParticipantColor(participant, fallbackIndex) {
  const ci = typeof participant?.colorIndex === 'number'
    ? participant.colorIndex
    : fallbackIndex;
  return PARTICIPANT_COLORS[ci % PARTICIPANT_COLORS.length];
}
