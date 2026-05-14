// TfL Journey disruption tiering (brief §5.4 / D12). Pure — no HTTP, no DB.
//
// We see disruptions on individual journey legs (`legs[].disruptions[]`) — each
// carries a `category` ('PlannedWork' | 'RealTime' | …), a `categoryDescription`
// (same string in practice), and a free-text `description`. The brief's three
// tiers are inferred from those text fields:
//
//   Suspended / Part-suspended → filter the route from results
//   Severe delays              → keep, but multiply score by 0.7 + red badge
//   Minor delays / Planned     → keep, yellow badge, no score change
//
// Anything we can't classify falls back to 'none' — the safest default for a
// solo-user app is to surface the journey unmodified and let the user read the
// detail page rather than silently down-rank on a phrase we don't recognise.

export type DisruptionTier = 'suspended' | 'severe' | 'minor' | 'none';

export interface DisruptionLike {
  category?: string;
  categoryDescription?: string;
  description?: string;
  summary?: string;
}

// "Suspended" / "Closed" / "Closure" / "Part Closure" / "Part Suspended" — and the
// specific "No service between X and Y" wording TfL uses for line/section closures
// (avoid matching the unrelated "no service alerts" by anchoring on the trailing word).
const SUSPENDED_RE = /\b(suspend|suspended|closed|closure|not running|part.{0,5}closure|part.{0,5}suspen|no service (between|on|to|until))/i;
const SEVERE_RE = /\bsevere\b/i;
const MINOR_RE = /\b(minor|planned\s?work|special\s?service|reduced\s?service)/i;

/** Classify a single disruption record. See brief §5.4 / D12. */
export function classifyDisruption(d: DisruptionLike): DisruptionTier {
  const text = `${d.category ?? ''} ${d.categoryDescription ?? ''} ${d.summary ?? ''} ${d.description ?? ''}`;
  if (SUSPENDED_RE.test(text)) return 'suspended';
  if (SEVERE_RE.test(text)) return 'severe';
  if (MINOR_RE.test(text)) return 'minor';
  return 'none';
}

// Tier ordering (worst → best) for "what's the worst thing happening on this journey?".
const TIER_RANK: Record<DisruptionTier, number> = { suspended: 3, severe: 2, minor: 1, none: 0 };

/** Find the worst tier across a set of disruptions. `[] → 'none'`. */
export function worstTier(ds: DisruptionLike[]): DisruptionTier {
  let worst: DisruptionTier = 'none';
  for (const d of ds) {
    const t = classifyDisruption(d);
    if (TIER_RANK[t] > TIER_RANK[worst]) worst = t;
  }
  return worst;
}

/** Multiplier for the journey's score (brief §5.4). 'suspended' is filtered earlier; this never sees it. */
export function scoreMultiplier(tier: DisruptionTier): number {
  if (tier === 'severe') return 0.7;
  return 1;
}
