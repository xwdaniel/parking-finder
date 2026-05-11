// Camden CPZ adapter (build-order step 3).
//
//   vf6e-iymu  — CPZ (sub-zone) polygons + Mon–Fri / Sat control hours  → `cpz`
//   7hiv-3r9k  — per-bay restrictions + LineString geometry            → `cpz_bay`
//
// Run:  npm run ingest:camden
//   Needs DATABASE_URL pointed at a PostGIS instance with the schema applied
//   (`psql "$DATABASE_URL" -f db/schema.sql`). Idempotent — transactional
//   delete-then-insert scoped to source_type / source.

import { pool } from '../../db/pool';
import { config } from '../../config';
import { fetchSocrataAll } from '../socrata';
import { writeCpzRecords } from '../cpz-store';
import type { CpzBayRecord } from '../types';
import {
  CAMDEN_SOURCE_TYPE,
  transformCamdenZones,
  transformCamdenBays,
  type CamdenZoneRow,
  type CamdenBayRow,
} from './camden-transform';

const DOMAIN = 'opendata.camden.gov.uk';
const ZONES_DATASET = 'vf6e-iymu';
const BAYS_DATASET = '7hiv-3r9k';

// --- DB writes ------------------------------------------------------------------

async function writeBays(records: CpzBayRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from cpz_bay where source = $1', [CAMDEN_SOURCE_TYPE]);
    for (const b of records) {
      await client.query(
        `insert into cpz_bay (id, source, borough, source_zone_code, road_name, restriction_type, times_of_operation, geom, last_synced_at)
         values ($1, $2, $3, $4, $5, $6, $7,
           case when $8::text is null then null else st_multi(st_setsrid(st_geomfromgeojson($8), 4326)) end,
           now())`,
        [b.id, b.source, b.borough, b.sourceZoneCode, b.roadName, b.restrictionType, b.timesOfOperation, b.geomGeoJson],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function summarise(): Promise<Record<string, number>> {
  const { rows } = await pool.query<Record<string, string>>(
    `select
       (select count(*) from cpz where source_type = $1)                                          as cpz_zones,
       (select count(*) from cpz where source_type = $1 and geom is not null)                      as cpz_with_geom,
       (select count(*) from cpz where source_type = $1 and hours is not null)                     as cpz_with_hours,
       (select count(*) from cpz_bay where source = $1)                                            as bays,
       (select count(distinct source_zone_code) from cpz_bay where source = $1)                    as bay_zone_codes,
       (select count(*) from cpz_bay where source = $1 and times_of_operation ilike 'at any time') as free_bays`,
    [CAMDEN_SOURCE_TYPE],
  );
  const r = rows[0] ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

// --- orchestration --------------------------------------------------------------

export async function ingestCamden(): Promise<void> {
  const appToken = config.socrataAppToken;

  console.log(`[camden] fetching ${ZONES_DATASET} (CPZ polygons)…`);
  const zoneRows = await fetchSocrataAll<CamdenZoneRow>({ domain: DOMAIN, dataset: ZONES_DATASET, appToken });
  const zones = transformCamdenZones(zoneRows);
  await writeCpzRecords(zones, CAMDEN_SOURCE_TYPE);
  console.log(`[camden] wrote ${zones.length} zones to cpz (from ${zoneRows.length} polygon rows)`);

  console.log(`[camden] fetching ${BAYS_DATASET} (per-bay detail)…`);
  const bayRows = await fetchSocrataAll<CamdenBayRow>({
    domain: DOMAIN,
    dataset: BAYS_DATASET,
    appToken,
    select:
      'unique_identifier,controlled_parking_zone,road_name,restriction_type,times_of_operation,epsg_4326_geojson_geometry',
  });
  const bays = transformCamdenBays(bayRows);
  await writeBays(bays);
  console.log(`[camden] wrote ${bays.length} bays to cpz_bay`);

  console.log('[camden] summary:', await summarise());
}

if (require.main === module) {
  ingestCamden()
    .then(() => pool.end())
    .then(() => console.log('[camden] done'))
    .catch((err: unknown) => {
      console.error('[camden] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
