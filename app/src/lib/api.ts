import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';

import { API_BASE_URL } from './env';

// Mirrors the backend GET /zones response (backend/src/routes/zones.ts, brief §6.2/§6.5).

export type ZoneReason =
  | 'red_route' // excluded — on the TLRN
  | 'active_cpz' // excluded — a CPZ operational at the query time
  | 'cpz_inactive' // eligible — governed by a known CPZ that's off right now
  | 'cpz_unknown' // eligible — in a CPZ whose hours we don't have ("verify with signage")
  | 'in_cpz_area' // eligible — inside a borough-level CPZ-coverage polygon, zone identity unknown
  | 'no_adapter' // eligible — borough has no CPZ adapter at all (confidence 0.4)
  | 'free'; // eligible — nothing positively says otherwise

export interface ZoneCpzRef {
  zoneId: string;
  name: string | null;
  hours: string | null;
}

export interface ZoneProperties {
  id: string;
  borough: string;
  streetName: string | null;
  parkingLane: string | null;
  parkingCondition: string | null;
  eligible: boolean;
  confidence: number; // 0 | 0.4 | 0.6 | 0.8 | 1.0
  reason: ZoneReason;
  zoneUnknown: boolean; // "in a CPZ, but which/when unknown" — drives the verify-with-signage badge
  boroughHasAdapter: boolean; // false ⇒ 0.4 tier ⇒ borough-scoped warning banner + hatched tint
  hours: string | null; // governing CPZ hours, when a single known one applies
  hoursSpread: string[] | null; // the borough's CPZ-hours spread (in_cpz_area context)
  activeCpz: { sourceZoneId: string; displayName: string | null; hours: string } | null; // set only when excluded by a CPZ
  cpz: ZoneCpzRef[]; // matched CPZ zone codes
}

export type ZoneFeature = Feature<MultiLineString | LineString, ZoneProperties>;

export interface ZonesResponse extends FeatureCollection<MultiLineString | LineString, ZoneProperties> {
  meta: { t: string; bbox: [number, number, number, number]; count: number; truncated: boolean };
}

export type Bbox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat

export interface ZonesQuery {
  bbox: Bbox;
  /** ISO-8601 arrival time; omit/null ⇒ backend uses "now". */
  t?: string | null;
}

/** GET /zones — every zone overlapping the bbox, with time-aware eligibility & confidence. */
export async function fetchZones({ bbox, t }: ZonesQuery, signal?: AbortSignal): Promise<ZonesResponse> {
  const params = new URLSearchParams({ bbox: bbox.join(',') });
  if (t) params.set('t', t);
  const res = await fetch(`${API_BASE_URL}/zones?${params.toString()}`, { signal });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`/zones ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as ZonesResponse;
}

// --- GET /search/walk (brief §5.1, build-order step 9) --------------------------

export interface WalkPoint {
  lat: number;
  lng: number;
}

/** One ranked candidate: the zone plus its closest point to the destination and the score components. */
export interface WalkResult {
  zone: ZoneFeature;
  walkPoint: WalkPoint;
  walkMinutes: number;
  score: number; // not shown to the user — informs sort order only (D16)
}

export interface WalkSearchResponse {
  destination: WalkPoint;
  t: string;
  maxWalkMinutes: number;
  results: WalkResult[];
  meta: { radiusMeters: number; candidatesConsidered: number; candidatesTruncated: boolean };
}

export interface WalkSearchQuery {
  destination: WalkPoint;
  maxWalkMinutes: number;
  /** ISO-8601 arrival time; omit/null ⇒ backend uses "now". */
  t?: string | null;
}

/** GET /search/walk — ranked walk-mode parking candidates (top 10) within the slider radius. */
export async function fetchWalkSearch({ destination, maxWalkMinutes, t }: WalkSearchQuery, signal?: AbortSignal): Promise<WalkSearchResponse> {
  const params = new URLSearchParams({
    lat: String(destination.lat),
    lng: String(destination.lng),
    maxWalkMinutes: String(maxWalkMinutes),
  });
  if (t) params.set('t', t);
  const res = await fetch(`${API_BASE_URL}/search/walk?${params.toString()}`, { signal });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`/search/walk ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as WalkSearchResponse;
}
