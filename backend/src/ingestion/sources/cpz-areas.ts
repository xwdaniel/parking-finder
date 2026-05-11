// Borough-level CPZ coverage adapter (build-order step 4c).
//
// Loads backend/static-data/<borough>-cpz-polygons.geojson (fetched from the Felt
// 2024 London-CPZ-by-borough map by `npm run fetch:felt-cpz`) and writes the
// polygons to `cpz_area`. These polygons carry NO per-zone identity — they only say
// "this area is inside a CPZ in borough X". The query (step 6) uses them to mark a
// street in a `polygon`-join borough as: inside a CPZ ⇒ confidence 0.6 ("verify with
// signage", since which zone's hours apply is unknown); outside all of them ⇒
// eligible. Per-zone polygons (which would attach a specific `cpz` row's hours) are
// still a data gap for Haringey / Tower Hamlets — they'd go in `cpz.geom`.
//
//   npm run fetch:felt-cpz        # (re)download the GeoJSON files
//   npm run ingest:cpz-areas      # → cpz_area  (needs DATABASE_URL with the schema applied)

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { pool } from '../../db/pool';
import { featureCollectionToAreaRecords } from './cpz-areas-transform';
import type { CpzAreaRecord } from '../types';

const STATIC_DIR = resolve(__dirname, '../../../static-data');
const SOURCE_TYPE = 'felt_2024';

// borough slug → static-data filename
const FILES: Record<string, string> = {
  haringey: 'haringey-cpz-polygons.geojson',
  tower_hamlets: 'tower-hamlets-cpz-polygons.geojson',
};

async function writeAreaRecords(records: CpzAreaRecord[], borough: string, sourceType: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from cpz_area where borough = $1 and source_type = $2', [borough, sourceType]);
    for (const r of records) {
      await client.query(
        `insert into cpz_area (id, borough, source_type, geom, last_synced_at)
         values ($1, $2, $3,
           st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson($4), 4326)), 3)),
           now())`,
        [r.id, r.borough, r.sourceType, r.geomGeoJson],
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

export interface CpzAreaIngestResult {
  borough: string;
  polygons: number;
  skipped: boolean;
}

export async function ingestCpzAreas(): Promise<CpzAreaIngestResult[]> {
  const results: CpzAreaIngestResult[] = [];
  for (const [borough, fileName] of Object.entries(FILES)) {
    const path = resolve(STATIC_DIR, fileName);
    if (!existsSync(path)) {
      console.warn(`[cpz-areas] ${borough}: ${fileName} missing — skipping (run \`npm run fetch:felt-cpz\` first)`);
      results.push({ borough, polygons: 0, skipped: true });
      continue;
    }
    const records = featureCollectionToAreaRecords(JSON.parse(readFileSync(path, 'utf8')), borough, SOURCE_TYPE);
    await writeAreaRecords(records, borough, SOURCE_TYPE);
    console.log(`[cpz-areas] ${borough}: wrote ${records.length} polygons to cpz_area`);
    results.push({ borough, polygons: records.length, skipped: false });
  }
  return results;
}

if (require.main === module) {
  ingestCpzAreas()
    .then((r) => console.log('[cpz-areas]', r))
    .then(() => pool.end())
    .then(() => console.log('[cpz-areas] done'))
    .catch((err: unknown) => {
      console.error('[cpz-areas] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
