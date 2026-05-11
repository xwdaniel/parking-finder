// OSM zone ingestion (build-order step 5).
//
// For each committed borough: Overpass fetch of highway=residential|living_street|
// unclassified ways with geometry → GeoJSON FeatureCollection (one Feature per way,
// carrying the parking-attribute tuple) → one SQL pass that clusters touching ways
// with the same attribute tuple (ST_ClusterDBSCAN, eps=0) and dissolves each cluster
// (ST_LineMerge) into one `zone` row. Full per-borough rebuild (DELETE then INSERT,
// in a transaction).
//
//   npm run ingest:osm        (needs DATABASE_URL with the schema applied)

import { pool } from '../../db/pool';
import { waysToFeatureCollection, type OverpassWay } from './osm-transform';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const HIGHWAY_FILTER = 'residential|living_street|unclassified';

// committed borough slug → OSM admin_level=8 relation name
const BOROUGHS: Record<string, string> = {
  camden: 'London Borough of Camden',
  waltham_forest: 'London Borough of Waltham Forest',
  haringey: 'London Borough of Haringey',
  tower_hamlets: 'London Borough of Tower Hamlets',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchOsmWays(boroughName: string): Promise<OverpassWay[]> {
  const q = `[out:json][timeout:180];
area["name"="${boroughName}"]["admin_level"="8"]->.b;
(way["highway"~"^(${HIGHWAY_FILTER})$"](area.b););
out geom;`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'parkfree-data-fetch' },
      body: new URLSearchParams({ data: q }),
    });
    const text = await res.text();
    if (res.ok && text.trimStart().startsWith('{')) {
      const data = JSON.parse(text) as { elements?: OverpassWay[] };
      return (data.elements ?? []).filter((e) => e.type === 'way');
    }
    if (attempt === 1) {
      await sleep(8000); // Overpass busy / rate-limited — back off and retry once
      continue;
    }
    throw new Error(`Overpass for "${boroughName}": HTTP ${res.status}; body starts: ${text.slice(0, 200)}`);
  }
  return [];
}

// One pass: unroll the FeatureCollection, cluster touching ways within each
// (borough, street_name, parking_lane, parking_condition, osm_zone_tag) partition,
// dissolve each cluster, insert one `zone` row per cluster.
const GROUP_AND_INSERT_SQL = `
with ways as (
  select
    feat->'properties'->>'way_id'            as way_id,
    feat->'properties'->>'borough'           as borough,
    feat->'properties'->>'street_name'       as street_name,
    feat->'properties'->>'parking_lane'      as parking_lane,
    feat->'properties'->>'parking_condition' as parking_condition,
    feat->'properties'->>'osm_zone_tag'      as osm_zone_tag,
    st_setsrid(st_geomfromgeojson(feat->'geometry'), 4326) as geom
  from jsonb_array_elements($1::jsonb->'features') as feat
), clustered as (
  select *,
         st_clusterdbscan(geom, 0, 1) over (
           partition by borough, street_name, parking_lane, parking_condition, osm_zone_tag
         ) as cid
  from ways
)
insert into zone (id, borough, geom, street_name, parking_lane, parking_condition, osm_zone_tag, source_way_ids, last_synced_at)
select
  -- borough-prefixed so a way on a borough boundary (returned by both adjacent
  -- boroughs' Overpass queries) doesn't collide with itself across boroughs
  borough || ':' || md5(string_agg(way_id, ',' order by way_id)),
  borough,
  st_multi(st_linemerge(st_collect(geom))),
  street_name, parking_lane, parking_condition, osm_zone_tag,
  array_agg(way_id order by way_id),
  now()
from clustered
group by borough, street_name, parking_lane, parking_condition, osm_zone_tag, cid
`;

export interface OsmIngestResult {
  borough: string;
  ways: number;
  zones: number;
}

export async function ingestOsmZonesForBorough(slug: string, boroughName: string): Promise<OsmIngestResult> {
  const ways = await fetchOsmWays(boroughName);
  const fc = waysToFeatureCollection(ways, slug);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from zone where borough = $1', [slug]);
    if (fc.features.length > 0) await client.query(GROUP_AND_INSERT_SQL, [JSON.stringify(fc)]);
    const { rows } = await client.query<{ n: string }>('select count(*)::text as n from zone where borough = $1', [slug]);
    await client.query('commit');
    return { borough: slug, ways: fc.features.length, zones: Number(rows[0]?.n ?? 0) };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function ingestOsmZones(): Promise<OsmIngestResult[]> {
  const out: OsmIngestResult[] = [];
  let first = true;
  for (const [slug, name] of Object.entries(BOROUGHS)) {
    if (!first) await sleep(3000); // be polite to Overpass between boroughs
    first = false;
    console.log(`[osm] fetching ${name} (highway=${HIGHWAY_FILTER})…`);
    const r = await ingestOsmZonesForBorough(slug, name);
    console.log(`[osm] ${slug}: ${r.ways} ways → ${r.zones} zones`);
    out.push(r);
  }
  return out;
}

if (require.main === module) {
  ingestOsmZones()
    .then((r) => console.log('[osm]', r))
    .then(() => pool.end())
    .then(() => console.log('[osm] done'))
    .catch((err: unknown) => {
      console.error('[osm] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
