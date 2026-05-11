// DB writes for the `cpz` table, shared by every CPZ adapter (Camden API, the
// static-JSON boroughs, …). Pure transforms live elsewhere; this module is the
// only one that touches the database for `cpz`.

import { pool } from '../db/pool';
import { loadStaticDataFile, staticZonesToCpzRecords } from './static';
import type { CpzRecord } from './types';

/**
 * Replace all `cpz` rows for `sourceType` with `records`, transactionally
 * (delete-then-insert — idempotent). Geometry: each record's `geomGeoJson` array
 * (possibly empty) is unioned into one MultiPolygon; an empty array ⇒ NULL geom
 * (static-JSON boroughs that join streets by OSM tag, or whose polygons are
 * sourced separately — build-order step 4c).
 */
export async function writeCpzRecords(records: CpzRecord[], sourceType: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from cpz where source_type = $1', [sourceType]);
    for (const z of records) {
      await client.query(
        `insert into cpz (id, borough, source_zone_id, display_name, geom, hours, source_type, last_synced_at)
         values ($1, $2, $3, $4,
           case when jsonb_array_length($5::jsonb) = 0 then null
                else st_multi(st_collectionextract(st_makevalid(st_setsrid(
                       st_union(array(select st_geomfromgeojson(x)
                                      from jsonb_array_elements_text($5::jsonb) as t(x))), 4326)), 3))
           end,
           $6, $7, now())`,
        [z.id, z.borough, z.sourceZoneId, z.displayName, JSON.stringify(z.geomGeoJson), z.hours, z.sourceType],
      );
    }
    await client.query('commit');
    return records.length;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export interface StaticIngestResult {
  sourceType: string;
  join: string;
  zones: number;
  withHours: number;
}

/** Load `backend/static-data/<fileName>` and write its zones to `cpz` (replacing that source). */
export async function ingestStaticBorough(fileName: string): Promise<StaticIngestResult> {
  const file = loadStaticDataFile(fileName);
  const records = staticZonesToCpzRecords(file);
  await writeCpzRecords(records, file.sourceType);
  return {
    sourceType: file.sourceType,
    join: file.join,
    zones: records.length,
    withHours: records.filter((r) => r.hours != null).length,
  };
}
