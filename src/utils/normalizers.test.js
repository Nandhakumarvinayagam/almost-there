/**
 * Tests for normalizeSession, normalizeParticipant (normalizers.js)
 * and computeHeadcountDelta (headcount.js).
 *
 * Run with: node --test src/utils/normalizers.test.js
 * Requires Node 24+ (built-in test runner, stable since Node 20).
 *
 * Every test maps to a specific backward-compatibility rule from
 * Plan v5, Section 4, or a headcount scenario from Section 9 / Appendix A.7.
 *
 * Fixture: a "pre-Social-Edition" session — the kind of raw Firebase snapshot
 * that existed before the Social Edition schema was deployed. It has:
 *   - no state, theme, hostId, headcount, permissions, blockedUsers,
 *     logistics, poll, activityFeed, reactions, or customFields nodes
 *   - ISO string timestamps instead of epoch milliseconds
 *   - participants without rsvpStatus or visibility fields
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSession, normalizeParticipant } from "./normalizers.js";
import { computeHeadcountDelta } from "./headcount.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Raw Firebase snapshot mimicking a session created before Social Edition. */
const legacySessionRaw = {
  destination: { lat: 37.7749, lng: -122.4194, address: "SF City Hall" },
  nickname: "Friday Game Night",
  notes: "Bring snacks",
  // hostId intentionally missing — pre-Social-Edition had no hostId
  createdAt: "2026-03-15T19:00:00.000Z",     // ISO string — Section 4, Rule 8
  scheduledTime: "2026-03-16T20:00:00.000Z", // ISO string
  expiresAt: "2026-03-16T22:00:00.000Z",     // ISO string
  arrivalRadius: 100,
  // Intentionally missing: state, theme, headcount, permissions, blockedUsers,
  // logistics, poll, activityFeed, reactions, customFields, hostSecretHash
};

/** Raw Firebase snapshot for a participant created before Social Edition. */
const legacyParticipantRaw = {
  name: "Nandha",
  colorIndex: 2,
  status: "en-route",
  // Intentionally missing: rsvpStatus, visibility, plusOnes, guestNote,
  // pollVote, customResponses, myReactions, nearbyStatus
};

// ---------------------------------------------------------------------------
// normalizeSession
// ---------------------------------------------------------------------------

describe("normalizeSession", () => {
  it("returns null when called with null", () => {
    assert.equal(normalizeSession(null), null);
  });

  it("returns null when called with undefined", () => {
    assert.equal(normalizeSession(undefined), null);
  });

  it("preserves fields that already exist on the raw object", () => {
    const result = normalizeSession(legacySessionRaw);
    assert.deepEqual(result.destination, legacySessionRaw.destination);
    assert.equal(result.nickname, "Friday Game Night");
    assert.equal(result.notes, "Bring snacks");
    assert.equal(result.arrivalRadius, 100);
  });

  // --- Section 4, Rule 1 — state machine default ---

  describe("Rule 1 — state defaults to 'active' for legacy sessions", () => {
    it("defaults state to 'active' when the field is missing", () => {
      assert.equal(normalizeSession(legacySessionRaw).state, "active");
    });

    it("defaults state to 'active' when the field is null", () => {
      assert.equal(normalizeSession({ ...legacySessionRaw, state: null }).state, "active");
    });

    it("preserves 'scheduled' when already set", () => {
      assert.equal(normalizeSession({ ...legacySessionRaw, state: "scheduled" }).state, "scheduled");
    });

    it("preserves 'completed' when already set", () => {
      assert.equal(normalizeSession({ ...legacySessionRaw, state: "completed" }).state, "completed");
    });
  });

  // --- Section 4, Rule 2 — host identity ---

  describe("Rule 2 — host identity defaults", () => {
    it("defaults hostId to null when missing", () => {
      assert.equal(normalizeSession(legacySessionRaw).hostId, null);
    });

    it("defaults hostSecretHash to null when missing", () => {
      assert.equal(normalizeSession(legacySessionRaw).hostSecretHash, null);
    });

    it("preserves hostId when provided", () => {
      assert.equal(
        normalizeSession({ ...legacySessionRaw, hostId: "uid_abc" }).hostId,
        "uid_abc"
      );
    });
  });

  // --- Section 4, Rule 3 — theme defaults ---

  describe("Rule 3 — theme defaults when theme node is missing", () => {
    it("provides full theme defaults when theme is missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).theme, {
        color: "#0066CC",
        emoji: "📍",
        style: "classic",
      });
    });

    it("fills only missing sub-fields within a partial theme object", () => {
      const result = normalizeSession({ ...legacySessionRaw, theme: { color: "#7C3AED" } });
      assert.equal(result.theme.color, "#7C3AED");
      assert.equal(result.theme.emoji, "📍");
      assert.equal(result.theme.style, "classic");
    });

    it("preserves a fully specified theme unchanged", () => {
      const custom = { color: "#FF0000", emoji: "🍕", style: "fancy" };
      assert.deepEqual(
        normalizeSession({ ...legacySessionRaw, theme: custom }).theme,
        custom
      );
    });
  });

  // --- Section 4, Rule 4 — headcount migration signal ---

  describe("Rule 4 — headcount null signals caller to run migration-on-read", () => {
    it("returns null for headcount when the field is missing", () => {
      assert.equal(normalizeSession(legacySessionRaw).headcount, null);
    });

    it("returns null for headcount when value is undefined", () => {
      assert.equal(
        normalizeSession({ ...legacySessionRaw, headcount: undefined }).headcount,
        null
      );
    });

    it("returns null when headcount is stored as a string (not a number)", () => {
      assert.equal(
        normalizeSession({ ...legacySessionRaw, headcount: "5" }).headcount,
        null
      );
    });

    it("preserves headcount when it is a positive number", () => {
      assert.equal(normalizeSession({ ...legacySessionRaw, headcount: 7 }).headcount, 7);
    });

    it("preserves headcount of 0 — a valid state (no going participants yet)", () => {
      assert.equal(normalizeSession({ ...legacySessionRaw, headcount: 0 }).headcount, 0);
    });
  });

  // --- Section 4, Rule 8 — timestamp normalization ---

  describe("Rule 8 — ISO string timestamps convert to epoch milliseconds", () => {
    it("converts ISO string scheduledTime to a number", () => {
      const result = normalizeSession(legacySessionRaw);
      const expected = new Date("2026-03-16T20:00:00.000Z").getTime();
      assert.equal(result.scheduledTime, expected);
      assert.equal(typeof result.scheduledTime, "number");
    });

    it("converts ISO string createdAt to epoch milliseconds", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.equal(result.createdAt, new Date("2026-03-15T19:00:00.000Z").getTime());
    });

    it("converts ISO string expiresAt to epoch milliseconds", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.equal(result.expiresAt, new Date("2026-03-16T22:00:00.000Z").getTime());
    });

    it("passes through numeric epoch ms timestamps unchanged", () => {
      const epochMs = 1742148000000;
      const result = normalizeSession({
        ...legacySessionRaw,
        scheduledTime: epochMs,
        createdAt: epochMs,
        expiresAt: epochMs,
      });
      assert.equal(result.scheduledTime, epochMs);
      assert.equal(result.createdAt, epochMs);
      assert.equal(result.expiresAt, epochMs);
    });

    it("normalizes scheduledTime to null when the field is absent", () => {
      const raw = { ...legacySessionRaw };
      delete raw.scheduledTime;
      assert.equal(normalizeSession(raw).scheduledTime, null);
    });

    it("falls back to a numeric createdAt when the field is absent", () => {
      const raw = { ...legacySessionRaw };
      delete raw.createdAt;
      assert.equal(typeof normalizeSession(raw).createdAt, "number");
    });

    it("falls back to a numeric expiresAt when the field is absent", () => {
      const raw = { ...legacySessionRaw };
      delete raw.expiresAt;
      assert.equal(typeof normalizeSession(raw).expiresAt, "number");
    });

    it("round-trips correctly: epoch ms parses back to the original ISO string", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.equal(
        new Date(result.scheduledTime).toISOString(),
        "2026-03-16T20:00:00.000Z"
      );
    });
  });

  // --- Section 4, Rule 9 — new social fields default to empty / null ---

  describe("Rule 9 — social fields default to safe empty values", () => {
    it("defaults permissions to { coHosts: {} } when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).permissions, { coHosts: {} });
    });

    it("defaults blockedUsers to {} when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).blockedUsers, {});
    });

    it("defaults logistics to {} when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).logistics, {});
    });

    it("defaults poll to null when missing", () => {
      assert.equal(normalizeSession(legacySessionRaw).poll, null);
    });

    it("defaults customFields to {} when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).customFields, {});
    });

    it("defaults activityFeed to {} when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).activityFeed, {});
    });

    it("defaults reactions to {} when missing", () => {
      assert.deepEqual(normalizeSession(legacySessionRaw).reactions, {});
    });

    it("preserves an existing permissions object with co-hosts", () => {
      const perms = { coHosts: { uid_xyz: true } };
      assert.deepEqual(
        normalizeSession({ ...legacySessionRaw, permissions: perms }).permissions,
        perms
      );
    });
  });

  // --- Crash guard ---

  describe("crash guard — component field access never throws", () => {
    it("accessing result.theme.color does not throw", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.doesNotThrow(() => result.theme.color);
    });

    it("accessing result.permissions.coHosts does not throw", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.doesNotThrow(() => result.permissions.coHosts);
    });

    it("accessing result.logistics.dressCode returns undefined (not a crash)", () => {
      const result = normalizeSession(legacySessionRaw);
      assert.equal(result.logistics.dressCode, undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeParticipant
// ---------------------------------------------------------------------------

describe("normalizeParticipant", () => {
  it("returns null when called with null", () => {
    assert.equal(normalizeParticipant(null), null);
  });

  it("returns null when called with undefined", () => {
    assert.equal(normalizeParticipant(undefined), null);
  });

  it("preserves fields that already exist on the raw object", () => {
    const result = normalizeParticipant(legacyParticipantRaw);
    assert.equal(result.name, "Nandha");
    assert.equal(result.colorIndex, 2);
    assert.equal(result.status, "en-route");
  });

  // --- Section 4, Rule 5 — rsvpStatus defaults ---

  describe("Rule 5 — rsvpStatus defaults to 'going' for pre-Social-Edition joins", () => {
    it("defaults rsvpStatus to 'going' when missing", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).rsvpStatus, "going");
    });

    it("defaults rsvpStatus to 'going' when null", () => {
      assert.equal(
        normalizeParticipant({ ...legacyParticipantRaw, rsvpStatus: null }).rsvpStatus,
        "going"
      );
    });

    it("preserves 'maybe' when explicitly set", () => {
      assert.equal(
        normalizeParticipant({ ...legacyParticipantRaw, rsvpStatus: "maybe" }).rsvpStatus,
        "maybe"
      );
    });

    it("preserves 'cant-go' when explicitly set", () => {
      assert.equal(
        normalizeParticipant({ ...legacyParticipantRaw, rsvpStatus: "cant-go" }).rsvpStatus,
        "cant-go"
      );
    });
  });

  // --- Section 4, Rule 6 — visibility defaults ---

  describe("Rule 6 — visibility defaults to 'visible'", () => {
    it("defaults visibility to 'visible' when missing", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).visibility, "visible");
    });

    it("preserves 'hidden' when explicitly set", () => {
      assert.equal(
        normalizeParticipant({ ...legacyParticipantRaw, visibility: "hidden" }).visibility,
        "hidden"
      );
    });
  });

  // --- Section 4, Rule 7 — pollVote defaults ---

  describe("Rule 7 — pollVote defaults to null (not voted)", () => {
    it("defaults pollVote to null when missing", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).pollVote, null);
    });

    it("preserves pollVote when it has a value", () => {
      assert.equal(
        normalizeParticipant({ ...legacyParticipantRaw, pollVote: "option_1" }).pollVote,
        "option_1"
      );
    });
  });

  // --- Social field defaults ---

  describe("social field defaults", () => {
    it("defaults plusOnes to 0", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).plusOnes, 0);
    });

    it("defaults guestNote to null", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).guestNote, null);
    });

    it("defaults customResponses to {}", () => {
      assert.deepEqual(normalizeParticipant(legacyParticipantRaw).customResponses, {});
    });

    it("defaults myReactions to {}", () => {
      assert.deepEqual(normalizeParticipant(legacyParticipantRaw).myReactions, {});
    });

    it("defaults nearbyStatus to false", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).nearbyStatus, false);
    });

    it("defaults status to 'not-started' when missing", () => {
      assert.equal(normalizeParticipant({ name: "Alex" }).status, "not-started");
    });

    it("does not provide a default for location — null means not tracking", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).location, undefined);
    });

    it("does not provide a default for eta — null means not tracking", () => {
      assert.equal(normalizeParticipant(legacyParticipantRaw).eta, undefined);
    });
  });

  it("defaults name to 'Anonymous' when missing", () => {
    assert.equal(normalizeParticipant({}).name, "Anonymous");
  });
});

// ---------------------------------------------------------------------------
// computeHeadcountDelta — all six scenarios from Plan v5 Appendix A.7
// ---------------------------------------------------------------------------

describe("computeHeadcountDelta", () => {
  // --- Scenario 1: New RSVP ---

  describe("Scenario 1 — New RSVP (no previous participant node)", () => {
    it("Going +2 plus-ones → delta +3", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: null, newStatus: "going", newPlusOnes: 2 }),
        3
      );
    });

    it("Going +0 plus-ones → delta +1", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: null, newStatus: "going", newPlusOnes: 0 }),
        1
      );
    });

    it("Maybe on new join → delta 0 (not counted in headcount)", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: null, newStatus: "maybe", newPlusOnes: 2 }),
        0
      );
    });

    it("Can't-Go on new join → delta 0", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: null, newStatus: "cant-go" }),
        0
      );
    });

    it("treats undefined oldStatus identically to null (new join)", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: undefined, newStatus: "going", newPlusOnes: 1 }),
        2
      );
    });
  });

  // --- Scenario 2: Going → not-Going ---

  describe("Scenario 2 — Going → Maybe / Can't Go", () => {
    it("Going (+1) → Maybe → delta -2", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "going", newStatus: "maybe", oldPlusOnes: 1 }),
        -2
      );
    });

    it("Going (+0) → Can't-Go → delta -1", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "going", newStatus: "cant-go", oldPlusOnes: 0 }),
        -1
      );
    });
  });

  // --- Scenario 3: not-Going → Going ---

  describe("Scenario 3 — Maybe / Can't Go → Going", () => {
    it("Maybe → Going with 0 plus-ones → delta +1", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "maybe", newStatus: "going", newPlusOnes: 0 }),
        1
      );
    });

    it("Can't-Go → Going with +1 → delta +2", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "cant-go", newStatus: "going", newPlusOnes: 1 }),
        2
      );
    });
  });

  // --- Scenario 4: Still Going, plus-ones changed ---

  describe("Scenario 4 — Still Going, plus-ones updated", () => {
    it("Going (+2 → +4) → delta +2", () => {
      assert.equal(
        computeHeadcountDelta({
          oldStatus: "going",
          newStatus: "going",
          oldPlusOnes: 2,
          newPlusOnes: 4,
        }),
        2
      );
    });

    it("Going (+3 → +1) → delta -2", () => {
      assert.equal(
        computeHeadcountDelta({
          oldStatus: "going",
          newStatus: "going",
          oldPlusOnes: 3,
          newPlusOnes: 1,
        }),
        -2
      );
    });

    it("Going (+2 → +2) → delta 0 (no-op — other fields changed)", () => {
      assert.equal(
        computeHeadcountDelta({
          oldStatus: "going",
          newStatus: "going",
          oldPlusOnes: 2,
          newPlusOnes: 2,
        }),
        0
      );
    });
  });

  // --- Scenario 5: Still not-Going (headcount unaffected) ---

  describe("Scenario 5 — Still Maybe / Can't-Go", () => {
    it("Maybe → Can't-Go → delta 0", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "maybe", newStatus: "cant-go" }),
        0
      );
    });

    it("Can't-Go → Maybe → delta 0 (plus-ones change irrelevant)", () => {
      assert.equal(
        computeHeadcountDelta({
          oldStatus: "cant-go",
          newStatus: "maybe",
          oldPlusOnes: 3,
          newPlusOnes: 0,
        }),
        0
      );
    });
  });

  // --- Scenario 6: Kick a Going participant ---

  describe("Scenario 6 — Kick a Going participant", () => {
    it("Kick Going (+3) → delta -4", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "going", oldPlusOnes: 3, isKick: true }),
        -4
      );
    });

    it("Kick Going (+0) → delta -1", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "going", oldPlusOnes: 0, isKick: true }),
        -1
      );
    });
  });

  // --- Scenario 7: Kick a Maybe / Can't-Go participant ---

  describe("Scenario 7 — Kick a Maybe / Can't-Go participant", () => {
    it("Kick Maybe → delta 0 (was never counted in headcount)", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "maybe", oldPlusOnes: 2, isKick: true }),
        0
      );
    });

    it("Kick Can't-Go → delta 0", () => {
      assert.equal(
        computeHeadcountDelta({ oldStatus: "cant-go", isKick: true }),
        0
      );
    });
  });
});
