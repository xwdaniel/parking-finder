// Time-aware inclusion (brief §6.2) + confidence tiers (§6.5) — the pure decision
// function. The caller (routes/zones.ts) does the PostGIS join and the `opening_hours`
// evaluation, then hands a fully-resolved per-zone snapshot here. No DB, no clock, no
// `opening_hours` import → trivially unit-testable, and the rules live in one place.
//
// Default flips from the original brief: a street is *eligible at T unless something
// positively says otherwise* (Red Route, or a CPZ operational at T). Confidence then
// reflects data-source quality, not OSM tag richness.

export type CpzMatchActivity = 'active' | 'inactive' | 'unknown';
//   'active'   — CPZ operational at the query time → excludes the zone
//   'inactive' — CPZ exists and is off at the query time → zone eligible, hours known
//   'unknown'  — CPZ matched but its hours are null or didn't parse → zone eligible, "verify with signage"

export interface MatchedCpz {
  sourceZoneId: string;        // the borough's own id, e.g. 'WSE' or 'CA-N Camden Square'
  displayName: string | null;
  hours: string | null;        // OSM opening_hours syntax; null if uncatalogued
  activity: CpzMatchActivity;
}

export interface ZoneEval {
  borough: string;             // 'camden' | 'waltham_forest' | 'haringey' | 'tower_hamlets' | <other>
  osmZoneTag: string | null;   // CPZ zone code from OSM parking:*:zone=* — positive evidence of being in a CPZ
  onRedRoute: boolean;         // zone.geom intersects a TfL Red Route
  matchedCpz: MatchedCpz[];    // cpz rows joined to this zone (spatially where cpz.geom exists; by osm_zone_tag otherwise)
  inCpzArea: boolean;          // zone.geom intersects a borough-level cpz_area coverage polygon (Haringey / TH)
  boroughHoursSpread: string[] | null;  // distinct cpz.hours in this borough — UI context for the cpz_area case
}

export type InclusionReason =
  | 'red_route'        // excluded — on the TLRN
  | 'active_cpz'       // excluded — a CPZ operational at the query time
  | 'cpz_inactive'     // eligible — governed by a known CPZ that's off right now (we have its hours)
  | 'cpz_unknown'      // eligible — in a CPZ whose hours we don't have ("verify with signage")
  | 'in_cpz_area'      // eligible — inside a borough-level CPZ-coverage polygon, zone identity unknown
  | 'no_adapter'       // eligible — borough has no CPZ adapter at all (confidence 0.4, warning banner)
  | 'free';            // eligible — nothing positively says otherwise

export interface ZoneInclusion {
  eligible: boolean;
  confidence: number;          // 0.4 | 0.6 | 0.8 | 1.0 — only meaningful when eligible (0 when excluded)
  reason: InclusionReason;
  zoneUnknown: boolean;        // "in a CPZ, but which/when is unknown" — drives the verify-with-signage badge
  boroughHasAdapter: boolean;  // false ⇒ 0.4 tier ⇒ borough-scoped warning banner + hatched tint (§4)
  appliedHours: string | null; // the governing CPZ hours, if a single known CPZ applies (for the UI hours summary)
  hoursSpread: string[] | null;// the borough's CPZ-hours spread, for the in_cpz_area context display
  activeCpz: { sourceZoneId: string; displayName: string | null; hours: string } | null; // set only when reason === 'active_cpz'
}

type BoroughKind = 'spatial_cpz' | 'tag_cpz' | 'area_cpz' | 'none';

interface BoroughPolicy {
  kind: BoroughKind;
  baseConfidence: number;  // confidence for an eligible zone with no positive in-CPZ evidence — the "source tier" (§6.5)
}

const BOROUGH_POLICY: Record<string, BoroughPolicy> = {
  // Camden: authoritative CPZ map (cpz.geom + hours). A Camden street outside every CPZ
  // polygon is genuinely uncontrolled — top confidence.
  camden:         { kind: 'spatial_cpz', baseConfidence: 1.0 },
  // Waltham Forest: streets join CPZ hours via the OSM zone tag (zone.osm_zone_tag = cpz.source_zone_id).
  // An untagged WF street is eligible at the borough source tier (the tag is an OSM data gap, not an assertion).
  waltham_forest: { kind: 'tag_cpz',     baseConfidence: 0.8 },
  // Haringey / Tower Hamlets: only borough-level cpz_area coverage (per-zone polygons are a data gap).
  // Inside a cpz_area polygon ⇒ "in a CPZ, which one unknown" (0.6); outside ⇒ not in a CPZ (source tier).
  haringey:       { kind: 'area_cpz',    baseConfidence: 0.8 },
  tower_hamlets:  { kind: 'area_cpz',    baseConfidence: 0.8 },
};

export function boroughPolicy(borough: string): BoroughPolicy {
  return BOROUGH_POLICY[borough] ?? { kind: 'none', baseConfidence: 0.4 };
}

/** Evaluate one zone against the query-time snapshot. See brief §6.2 / §6.5. */
export function evaluateZone(z: ZoneEval): ZoneInclusion {
  const policy = boroughPolicy(z.borough);
  const boroughHasAdapter = policy.kind !== 'none';

  const result = (over: Partial<ZoneInclusion>): ZoneInclusion => ({
    eligible: true,
    confidence: policy.baseConfidence,
    reason: 'free',
    zoneUnknown: false,
    boroughHasAdapter,
    appliedHours: null,
    hoursSpread: null,
    activeCpz: null,
    ...over,
  });

  // 1. TfL Red Route — excluded unconditionally (brief §6.1).
  if (z.onRedRoute) {
    return result({ eligible: false, confidence: 0, reason: 'red_route' });
  }

  // 2. Any matched CPZ operational at the query time — excluded.
  const active = z.matchedCpz.find((c) => c.activity === 'active');
  if (active) {
    return result({
      eligible: false,
      confidence: 0,
      reason: 'active_cpz',
      activeCpz: { sourceZoneId: active.sourceZoneId, displayName: active.displayName, hours: active.hours ?? '' },
    });
  }

  // 3. Eligible — pick the confidence tier.

  // (a) Borough with no CPZ adapter at all → 0.4, warning banner. We don't even know whether a CPZ exists here.
  if (policy.kind === 'none') {
    return result({ confidence: 0.4, reason: 'no_adapter' });
  }

  // (b) Matched a CPZ that's off right now — we know exactly which zone governs the street and its hours.
  //     Confidence stays at the borough source tier (1.0 Camden / 0.8 WF) — these are authoritative hours.
  const inactiveWithHours = z.matchedCpz.find((c) => c.activity === 'inactive' && c.hours);
  if (inactiveWithHours) {
    return result({ confidence: policy.baseConfidence, reason: 'cpz_inactive', appliedHours: inactiveWithHours.hours });
  }

  // (c) Matched a CPZ row but couldn't read its hours (null / unparseable) — in a CPZ, hours unknown.
  if (z.matchedCpz.some((c) => c.activity === 'unknown')) {
    return result({ confidence: 0.6, reason: 'cpz_unknown', zoneUnknown: true });
  }

  // (d) Tag-join borough (WF) and the street carries an OSM zone tag we have no usable hours for
  //     (no matching cpz row at all) — the tag is positive evidence of a CPZ ⇒ 0.6, verify with signage.
  if (policy.kind === 'tag_cpz' && z.osmZoneTag != null) {
    return result({ confidence: 0.6, reason: 'cpz_unknown', zoneUnknown: true });
  }

  // (e) Area-coverage borough (Haringey / TH) and the street is inside a CPZ-coverage polygon ⇒ 0.6,
  //     verify with signage, with the borough's hours spread surfaced as context (§4, §6.5).
  if (policy.kind === 'area_cpz' && z.inCpzArea) {
    return result({ confidence: 0.6, reason: 'in_cpz_area', zoneUnknown: true, hoursSpread: z.boroughHoursSpread });
  }

  // (f) Nothing positively says otherwise — eligible at the borough source tier
  //     (Camden street outside every CPZ → 1.0; untagged WF street → 0.8; Haringey/TH street
  //      outside every cpz_area polygon → 0.8).
  return result({ reason: 'free' });
}
