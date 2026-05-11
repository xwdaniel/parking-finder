// Fetch the Felt "London Controlled Parking Zones by borough — 2024" polygon layer
// for the committed `polygon`-join boroughs and write one GeoJSON FeatureCollection
// per borough to backend/static-data/<borough>-cpz-polygons.geojson.
//
//   npm run fetch:felt-cpz      (or:  tsx src/ingestion/scripts/fetch-felt-cpz.ts)
//
// Source: https://felt.com/map/B3MJYQpnQXGbIL9C0TK4biD (William Petty / Healthy
// Streets Scorecard coalition; from local-authority submissions, current 16 May 2024).
// The layer's per-feature endpoint serves full-fidelity geometry by integer id; the
// only useful property is `name` = borough. So these polygons give borough-level CPZ
// COVERAGE, not per-zone identity — see `sources/cpz-areas.ts` and brief §6.5.
//
// Re-running overwrites the GeoJSON files. ~1300 small requests with a polite delay.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const LAYER = 'af70c683-08c3-4a88-a9d7-821c00004453';
const FEATURE_URL = (id: number) => `https://us1.data-pipeline.felt.com/onefeature/${LAYER}/${id}.geojson`;
const STATIC_DIR = resolve(__dirname, '../../../static-data');

// Felt `name` value → our borough slug. Only these are written out.
const BOROUGHS: Record<string, string> = {
  Haringey: 'haringey',
  'Tower Hamlets': 'tower_hamlets',
};

const MAX_ID = Number(process.env.FELT_MAX_ID ?? 5000);
const STOP_AFTER_CONSECUTIVE_MISSES = 30;
const DELAY_MS = Number(process.env.FELT_DELAY_MS ?? 60);

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
  bbox?: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFeature(id: number): Promise<GeoJsonFeature | null> {
  const res = await fetch(FEATURE_URL(id), {
    headers: { Referer: 'https://felt.com/', 'User-Agent': 'parkfree-data-fetch' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Felt feature ${id}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim() === '') return null;
  const f = JSON.parse(text) as GeoJsonFeature;
  if (f.type !== 'Feature' || !f.geometry) throw new Error(`Felt feature ${id}: not a Feature`);
  return f;
}

async function main(): Promise<void> {
  const byBorough = new Map<string, GeoJsonFeature[]>();
  for (const slug of Object.values(BOROUGHS)) byBorough.set(slug, []);

  let misses = 0;
  let scanned = 0;
  for (let id = 1; id <= MAX_ID; id += 1) {
    const f = await fetchFeature(id);
    scanned += 1;
    if (!f) {
      misses += 1;
      if (misses >= STOP_AFTER_CONSECUTIVE_MISSES) break;
      continue;
    }
    misses = 0;
    const name = typeof f.properties?.name === 'string' ? f.properties.name : '';
    const slug = BOROUGHS[name];
    if (slug) {
      // keep only geometry + the borough name; drop Felt's styling props
      byBorough.get(slug)!.push({ type: 'Feature', geometry: f.geometry, properties: { borough: slug, felt_id: id } });
    }
    if (scanned % 200 === 0) console.log(`[fetch-felt-cpz] scanned ${scanned} features…`);
    await sleep(DELAY_MS);
  }

  mkdirSync(STATIC_DIR, { recursive: true });
  for (const [slug, features] of byBorough) {
    const out = resolve(STATIC_DIR, `${slug.replace(/_/g, '-')}-cpz-polygons.geojson`);
    const fc = {
      type: 'FeatureCollection' as const,
      name: `${slug} CPZ areas (Felt 2024)`,
      source: 'https://felt.com/map/B3MJYQpnQXGbIL9C0TK4biD — London CPZ by borough, 2024 (Healthy Streets Scorecard). Borough-level coverage only — no per-zone identity.',
      generatedAt: new Date().toISOString().slice(0, 10),
      features,
    };
    writeFileSync(out, JSON.stringify(fc) + '\n');
    console.log(`[fetch-felt-cpz] ${slug}: ${features.length} polygons → ${out}`);
  }
  console.log(`[fetch-felt-cpz] done (scanned ${scanned} Felt features)`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('[fetch-felt-cpz] FAILED:', err);
    process.exit(1);
  });
}
