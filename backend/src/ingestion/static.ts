// Shared support for static-JSON CPZ adapters (Waltham Forest, Haringey, Tower
// Hamlets). Each borough has a hand-built `backend/static-data/<borough>.json` in
// the canonical shape below; a thin `sources/<borough>.ts` loads it and writes
// `cpz` rows. Geometry is NOT in these files — WF joins streets to zones via OSM
// `parking:*:zone=*` tags, while Haringey / Tower Hamlets get polygons added
// separately (build-order step 4c) and joined spatially.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { slug } from './util';
import type { CpzRecord } from './types';

export type StaticZoneJoin = 'osm_zone_tag' | 'polygon';

export interface StaticZone {
  /** Zone identifier used for joining: an OSM zone-tag value ('WSE', 'WXS(w)') or a polygon key. */
  code: string;
  name: string | null;
  /** OSM opening_hours syntax for the restricted window; null if uncatalogued. */
  hours: string | null;
  /** Free text qualifier ('non-event; event days vary', 'PDF had no hours text', …). */
  note: string | null;
  /** Where the hours came from ('pdftotext', 'ocr', 'web_search', 'council html table', …). */
  provenance: string | null;
}

export interface StaticDataFile {
  /** Slug used as `cpz.borough` and in `cpz.id` / `source_type`. */
  borough: string;
  displayBorough: string;
  /** How streets link to these zones. */
  join: StaticZoneJoin;
  /** Value written to `cpz.source_type`. */
  sourceType: string;
  /** ISO date the file was generated. */
  generatedAt: string;
  /** Human description of where the data came from. */
  source: string;
  zones: StaticZone[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asString(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new Error(`static data: expected string at ${where}, got ${typeof v}`);
  return v;
}
function asNullableString(v: unknown, where: string): string | null {
  if (v == null) return null;
  return asString(v, where);
}

/** Validate an unknown value as a StaticDataFile (throws on any structural problem). */
export function parseStaticDataFile(raw: unknown): StaticDataFile {
  if (!isObject(raw)) throw new Error('static data: root must be an object');
  const join = asString(raw.join, 'join');
  if (join !== 'osm_zone_tag' && join !== 'polygon') {
    throw new Error(`static data: join must be 'osm_zone_tag' or 'polygon', got '${join}'`);
  }
  if (!Array.isArray(raw.zones)) throw new Error('static data: zones must be an array');

  const zones: StaticZone[] = raw.zones.map((z, i) => {
    if (!isObject(z)) throw new Error(`static data: zones[${i}] must be an object`);
    const code = asString(z.code, `zones[${i}].code`).trim();
    if (code === '') throw new Error(`static data: zones[${i}].code is empty`);
    return {
      code,
      name: asNullableString(z.name, `zones[${i}].name`),
      hours: asNullableString(z.hours, `zones[${i}].hours`),
      note: asNullableString(z.note, `zones[${i}].note`),
      provenance: asNullableString(z.provenance, `zones[${i}].provenance`),
    };
  });

  const seen = new Set<string>();
  for (const z of zones) {
    if (seen.has(z.code)) throw new Error(`static data: duplicate zone code '${z.code}'`);
    seen.add(z.code);
  }

  return {
    borough: asString(raw.borough, 'borough'),
    displayBorough: asString(raw.displayBorough, 'displayBorough'),
    join,
    sourceType: asString(raw.sourceType, 'sourceType'),
    generatedAt: asString(raw.generatedAt, 'generatedAt'),
    source: asString(raw.source, 'source'),
    zones,
  };
}

/**
 * Resolve `backend/static-data/<file>` and load+validate it. Works whether running
 * from `src/` via tsx (dev) or `dist/` via node (prod): `__dirname` is
 * `…/backend/{src,dist}/ingestion`, so `../../static-data` ⇒ `…/backend/static-data`.
 */
export function loadStaticDataFile(fileName: string): StaticDataFile {
  const path = resolve(__dirname, '../../static-data', fileName);
  return parseStaticDataFile(JSON.parse(readFileSync(path, 'utf8')));
}

/** Map a static-data file to `cpz` rows (no geometry — see module header). */
export function staticZonesToCpzRecords(file: StaticDataFile): CpzRecord[] {
  return file.zones.map((z) => ({
    id: `${file.borough}:${slug(z.code)}`,
    borough: file.borough,
    sourceZoneId: z.code,
    displayName: z.name,
    geomGeoJson: [],
    hours: z.hours,
    sourceType: file.sourceType,
  }));
}
