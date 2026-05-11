// Pure transforms for the OSM zone ingestion (step 5). No I/O, no DB. The grouping
// of contiguous ways into `zone` rows happens in SQL (ST_ClusterDBSCAN + ST_LineMerge)
// in osm.ts — this module just turns Overpass ways into GeoJSON Features carrying the
// parking-attribute tuple the grouping partitions by.

export interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>; // present with Overpass `out geom;`
}

export interface ZoneFeature {
  type: 'Feature';
  properties: {
    way_id: string;
    borough: string;
    street_name: string | null;
    parking_lane: string | null;
    parking_condition: string | null;
    osm_zone_tag: string | null;
  };
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
}

// Recognised "there is parking here, oriented like X" values (old `parking:lane:*` and
// new `parking:*` / `parking:*:orientation` schemas). We keep a representative one.
const POSITIVE_LANE_VALUES = new Set([
  'parallel', 'diagonal', 'perpendicular',
  'on_street', 'half_on_kerb', 'on_kerb', 'painted_area_only', 'lane', 'street_side',
]);
const LANE_KEYS = [
  'parking:lane:both', 'parking:lane:left', 'parking:lane:right',
  'parking:both', 'parking:left', 'parking:right',
  'parking:both:orientation', 'parking:left:orientation', 'parking:right:orientation',
];

// Recognised parking-condition / restriction values (old `parking:condition:*`, new
// `parking:*:restriction`). Drives nothing in the model (CPZ data does that — OSM
// coverage is ~0%), but kept so a free segment isn't merged with an adjacent permit one.
const CONDITION_VALUES = new Set([
  'free', 'no_charge', 'yes',
  'permit', 'residents', 'disc', 'ticket', 'customers',
  'no_parking', 'no_stopping', 'private',
]);
const CONDITION_KEY_RE = /^parking:(condition:)?(both|left|right)(:restriction)?$/;

// CPZ zone-code tags: parking:both:zone=WSE, parking:left:zone=CA-N, parking:condition:both:zone=…
const ZONE_KEY_RE = /^parking:.*zone$/;

export function extractParkingLane(tags: Record<string, string>): string | null {
  for (const k of LANE_KEYS) {
    const v = tags[k];
    if (v && POSITIVE_LANE_VALUES.has(v)) return v;
  }
  return null;
}

export function extractParkingCondition(tags: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(tags)) {
    if (CONDITION_KEY_RE.test(k) && CONDITION_VALUES.has(v)) return v;
  }
  return null;
}

export function extractZoneTag(tags: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(tags)) {
    if (ZONE_KEY_RE.test(k)) {
      const first = String(v).split(';')[0]?.trim();
      if (first) return first;
    }
  }
  return null;
}

export function wayToZoneFeature(way: OverpassWay, borough: string): ZoneFeature | null {
  const geom = way.geometry;
  if (!geom || geom.length < 2) return null;
  const tags = way.tags ?? {};
  return {
    type: 'Feature',
    properties: {
      way_id: String(way.id),
      borough,
      street_name: tags.name?.trim() || null,
      parking_lane: extractParkingLane(tags),
      parking_condition: extractParkingCondition(tags),
      osm_zone_tag: extractZoneTag(tags),
    },
    geometry: { type: 'LineString', coordinates: geom.map((p) => [p.lon, p.lat]) },
  };
}

export function waysToFeatureCollection(ways: OverpassWay[], borough: string): {
  type: 'FeatureCollection';
  features: ZoneFeature[];
} {
  const features: ZoneFeature[] = [];
  for (const w of ways) {
    if (w.type !== 'way') continue;
    const f = wayToZoneFeature(w, borough);
    if (f) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}
