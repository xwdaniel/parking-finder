// TfL StopPoint ingestion (build-order step 10, brief §5.2).
//
// Fetches Tube / DLR / Overground / Elizabeth-line stations from the TfL Unified
// API and writes one row per station into `tfl_stop`. The transit-mode ranked
// search (`/search/transit`) uses these to pick K=3 nearest stops per candidate
// parking zone, then asks ST_ClosestPoint to bias the *zonePoint* toward each
// stop. TfL Journey itself is still called with lat/lng (never stop IDs, §9).
//
//   npm run ingest:tfl-stops   # needs DATABASE_URL with the schema applied
//
// Cadence: weekly (the station set changes very slowly — new lines / openings
// at most a few per year). No app_key required for StopPoint reads at the
// free-tier rate (500/hr); we pass it if present for politeness.

import { config } from '../../config';
import { pool } from '../../db/pool';
import { projectStopPoints, type RawTflStopPoint, type TflStopRecord } from './tfl-stops-transform';

const TFL_BASE = 'https://api.tfl.gov.uk';

interface TflTypePage {
  // /StopPoint/Type/<type>/page/<n> returns a flat array (different shape from /StopPoint/Mode/*).
  // We only need a handful of fields; the type stays loose so future fields don't break the load.
  [k: string]: unknown;
}

async function fetchType(stopType: 'NaptanMetroStation' | 'NaptanRailStation', page: number): Promise<RawTflStopPoint[]> {
  const url = new URL(`${TFL_BASE}/StopPoint/Type/${stopType}/page/${page}`);
  if (config.tflAppKey) url.searchParams.set('app_key', config.tflAppKey);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TfL ${stopType} page ${page} → ${res.status} ${res.statusText}`);
  const body = (await res.json()) as TflTypePage[] | { message?: string };
  if (!Array.isArray(body)) throw new Error(`TfL ${stopType} page ${page}: unexpected response (${JSON.stringify(body).slice(0, 200)})`);
  return body as RawTflStopPoint[];
}

async function fetchAllPages(stopType: 'NaptanMetroStation' | 'NaptanRailStation', maxPages = 20): Promise<RawTflStopPoint[]> {
  const all: RawTflStopPoint[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchType(stopType, page);
    if (rows.length === 0) break;
    all.push(...rows);
  }
  return all;
}

async function writeStops(records: TflStopRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from tfl_stop'); // full refresh — there's only one source
    for (const r of records) {
      await client.query(
        `insert into tfl_stop (id, name, modes, geom, last_synced_at)
         values ($1, $2, $3, st_setsrid(st_makepoint($4, $5), 4326), now())`,
        [r.id, r.name, r.modes, r.lng, r.lat],
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

export interface TflStopsIngestResult {
  fetched: number; // raw rows fetched from TfL across both stop-types
  written: number; // rows actually written to tfl_stop (i.e. routed-mode stations)
}

export async function ingestTflStops(): Promise<TflStopsIngestResult> {
  const metro = await fetchAllPages('NaptanMetroStation'); // Tube + DLR mostly (+ tram/cable-car/etc., filtered out by transform)
  const rail = await fetchAllPages('NaptanRailStation');   // Overground + Elizabeth-line + lots of national-rail (filtered out)
  const fetched = metro.length + rail.length;
  console.log(`[tfl-stops] fetched ${metro.length} metro + ${rail.length} rail rows from TfL`);
  const records = projectStopPoints([...metro, ...rail]);
  console.log(`[tfl-stops] keeping ${records.length} routed stations after filter (tube/dlr/overground/elizabeth-line)`);
  await writeStops(records);
  return { fetched, written: records.length };
}

if (require.main === module) {
  ingestTflStops()
    .then((r) => console.log('[tfl-stops]', r))
    .then(() => pool.end())
    .then(() => console.log('[tfl-stops] done'))
    .catch((err: unknown) => {
      console.error('[tfl-stops] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
