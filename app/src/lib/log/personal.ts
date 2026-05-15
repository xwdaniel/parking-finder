import type { OutcomeRow } from './types';
import type { ZoneProperties } from '../api';

// Display-time personal overrides (brief §7, D31).
//
// The personal log overrides the data-source confidence per the snippet in §7:
//   `displayConfidence = personalConfidence(zoneId) ?? sourceConfidence(zoneId)`
//
// We *do not* re-rank the list — the server score is authoritative; personal overrides
// adjust how each candidate is *displayed* (tier colour, dot count, badges) so the user
// reads "where I've parked free before" / "where I got ticketed" at a glance without
// having the list silently reshuffle.

/** How long a `parked_ok` outcome continues to bump display confidence to 1.0. */
const PARKED_OK_RECENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PersonalOverride {
  /** New confidence value to render. Null ⇒ no override. */
  confidence: number | null;
  /** True ⇒ render as excluded regardless of server eligibility (you got a ticket here). */
  forceExcluded: boolean;
  /** True ⇒ clear `zoneUnknown` because the user verified the rules from signage. */
  clearZoneUnknown: boolean;
  /** Short label for the per-zone badge, e.g. "Parked free here" / "Ticketed here". */
  badge: string | null;
  /** The raw outcome row, for the detail view. */
  outcome: OutcomeRow;
}

export function personalOverride(outcome: OutcomeRow, nowMs = Date.now()): PersonalOverride | null {
  switch (outcome.lastOutcome) {
    case 'parked_ok': {
      const at = outcome.lastOutcomeAt ? Date.parse(outcome.lastOutcomeAt) : NaN;
      const recent = Number.isFinite(at) && nowMs - at <= PARKED_OK_RECENT_DAYS * DAY_MS;
      return {
        confidence: recent ? 1.0 : 0.8,
        forceExcluded: false,
        clearZoneUnknown: true, // you parked here free — the rules clearly allow it
        badge: outcome.parkedCount > 1 ? `Parked free here ×${outcome.parkedCount}` : 'Parked free here',
        outcome,
      };
    }
    case 'ticketed':
      return {
        confidence: 0,
        forceExcluded: true,
        clearZoneUnknown: false,
        badge: 'Ticketed here',
        outcome,
      };
    case 'verified_hours':
      // We know the rules now — promote the display tier; the time-aware inclusion still runs
      // against server data, but the "verify with signage" warning is no longer accurate.
      return {
        confidence: 0.8,
        forceExcluded: false,
        clearZoneUnknown: true,
        badge: 'Hours verified',
        outcome,
      };
    case 'sign_said_permit':
      // The data said "free" but the sign said permit-only — drop confidence to "no zone data".
      return {
        confidence: 0.4,
        forceExcluded: false,
        clearZoneUnknown: false,
        badge: 'Sign said permit',
        outcome,
      };
    case 'unsafe':
    case 'no_space':
      // Cosmetic only — these are about the spot, not the rules.
      return {
        confidence: null,
        forceExcluded: false,
        clearZoneUnknown: false,
        badge: outcome.lastOutcome === 'unsafe' ? 'You marked unsafe' : 'No space last time',
        outcome,
      };
    default:
      return null;
  }
}

/** Apply an override to the server's ZoneProperties, returning a new object (server props are immutable). */
export function applyPersonalOverride(p: ZoneProperties, override: PersonalOverride | null): ZoneProperties {
  if (!override) return p;
  return {
    ...p,
    eligible: override.forceExcluded ? false : p.eligible,
    confidence: override.confidence ?? p.confidence,
    zoneUnknown: override.clearZoneUnknown ? false : p.zoneUnknown,
  };
}
