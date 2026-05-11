// Pure transforms for the Camden CPZ adapter — no I/O, no DB, no env. Unit-tested in
// camden-transform.test.ts; consumed by camden.ts which adds fetch + DB writes.

import { camdenHours } from '../hours';
import type { CpzRecord, CpzBayRecord } from '../types';

export const CAMDEN_BOROUGH = 'camden';
export const CAMDEN_SOURCE_TYPE = 'camden_socrata';

// --- raw row shapes (only the fields we use) ------------------------------------

export interface CamdenZoneRow {
  controlled_parking_zone_code?: string;
  controlled_parking_zone_name?: string;
  sub_zone_name?: string;
  control_monday_to_friday?: string;
  control_saturday?: string;
  location?: { type?: string; coordinates?: unknown }; // GeoJSON Polygon
}

export interface CamdenBayRow {
  unique_identifier?: string;
  controlled_parking_zone?: string;
  road_name?: string;
  restriction_type?: string;
  times_of_operation?: string;
  epsg_4326_geojson_geometry?: string; // stringified GeoJSON LineString | MultiLineString
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Group the polygon rows by zone *name* (the finest distinct-hours unit — Camden splits
 * a zone into several sub-zone polygons that share a name and hours; e.g. CA-F has
 * (n)/(nw)/(s) sub-zones with different hours, but each "(x)" appears under one name).
 * One `cpz` row per name, collecting all its polygons for the DB layer to union.
 */
export function transformCamdenZones(rows: CamdenZoneRow[]): CpzRecord[] {
  const byName = new Map<
    string,
    { name: string; mf: string | null; sat: string | null; geoms: string[] }
  >();

  for (const r of rows) {
    const name = (r.controlled_parking_zone_name ?? '').trim();
    if (!name) continue;
    let g = byName.get(name);
    if (!g) {
      g = { name, mf: r.control_monday_to_friday ?? null, sat: r.control_saturday ?? null, geoms: [] };
      byName.set(name, g);
    }
    if (r.location && typeof r.location.type === 'string') {
      g.geoms.push(JSON.stringify({ type: r.location.type, coordinates: r.location.coordinates }));
    }
  }

  return [...byName.values()].map((g) => ({
    id: `${CAMDEN_BOROUGH}:${slug(g.name)}`,
    borough: CAMDEN_BOROUGH,
    sourceZoneId: g.name,
    displayName: g.name,
    geomGeoJson: g.geoms,
    hours: camdenHours(g.mf, g.sat),
    sourceType: CAMDEN_SOURCE_TYPE,
  }));
}

export function transformCamdenBays(rows: CamdenBayRow[]): CpzBayRecord[] {
  const out: CpzBayRecord[] = [];
  for (const r of rows) {
    const uid = (r.unique_identifier ?? '').trim();
    if (!uid) continue;
    const geo = (r.epsg_4326_geojson_geometry ?? '').trim();
    out.push({
      id: `${CAMDEN_BOROUGH}:${uid}`,
      source: CAMDEN_SOURCE_TYPE,
      borough: CAMDEN_BOROUGH,
      sourceZoneCode: r.controlled_parking_zone?.trim() || null,
      roadName: r.road_name?.trim() || null,
      restrictionType: r.restriction_type?.trim() || null,
      timesOfOperation: r.times_of_operation?.trim() || null,
      geomGeoJson: geo.length > 0 ? geo : null,
    });
  }
  return out;
}
