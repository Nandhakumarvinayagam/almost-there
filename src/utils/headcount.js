/**
 * Headcount delta utility for the denormalized headcount counter.
 *
 * Headcount only includes participants with 'going' rsvpStatus, each
 * counting as 1 + their plusOnes.
 *
 * All delta inputs (oldStatus, newStatus, oldPlusOnes, newPlusOnes) are scoped
 * to the current user's own participant node, which only they can write.
 * There is no stale-data risk from concurrent writes by other users —
 * User A's plusOnes is only ever written by User A.
 *
 * The headcount counter itself must be updated via runTransaction() to handle
 * concurrent increments from multiple users RSVPing simultaneously.
 *
 * Reference: Plan v5, Sections 4 (Rule 4) and 9 (Headcount Transaction: Delta Math)
 *
 * @param {object} params
 * @param {string|null|undefined} params.oldStatus  - Previous rsvpStatus; null for new joins
 * @param {string}                params.newStatus  - Incoming rsvpStatus
 * @param {number}                [params.oldPlusOnes=0] - Previous plusOnes value
 * @param {number}                [params.newPlusOnes=0] - Incoming plusOnes value
 * @param {boolean}               [params.isKick=false]  - True when the host is kicking a participant
 * @returns {number} Delta to apply to the headcount counter (may be 0, positive, or negative)
 */
export const computeHeadcountDelta = ({
  oldStatus,
  newStatus,
  oldPlusOnes = 0,
  newPlusOnes = 0,
  isKick = false,
}) => {
  // Scenarios 6 & 7: Host kick — remove the participant's contribution entirely
  if (isKick) {
    return oldStatus === "going" ? -(1 + oldPlusOnes) : 0;
  }

  // Scenario 1: New RSVP — participant node did not exist before
  if (!oldStatus) {
    return newStatus === "going" ? 1 + newPlusOnes : 0;
  }

  // Scenario 2: Going → not-Going (Maybe or Can't Go)
  if (oldStatus === "going" && newStatus !== "going") {
    return -(1 + oldPlusOnes);
  }

  // Scenario 3: not-Going → Going
  if (oldStatus !== "going" && newStatus === "going") {
    return 1 + newPlusOnes;
  }

  // Scenarios 4 & 5: Still Going — only plus-ones may have changed.
  // When newPlusOnes === oldPlusOnes the result is 0 (correct no-op).
  if (oldStatus === "going" && newStatus === "going") {
    return newPlusOnes - oldPlusOnes;
  }

  // All other transitions (e.g. Maybe → Can't Go) do not affect headcount
  return 0;
};
