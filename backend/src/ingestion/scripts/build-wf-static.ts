// Build backend/static-data/waltham-forest.json from the Step-0 spike artefact
// (osm_spike/waltham_forest_cpz_hours.json) into the canonical static-data shape.
//
//   npm run build:static-data:wf      (or:  tsx src/ingestion/scripts/build-wf-static.ts)
//
// Re-run whenever the spike JSON changes (e.g. a `verified_hours` outcome is synced back).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { parseStaticDataFile, type StaticDataFile, type StaticZone } from '../static';

interface SpikeZone {
  osm_zone_tag?: string;
  zone_name?: string | null;
  hours_osm_syntax?: string | null;
  source?: string | null;
  note?: string | null;
}
interface SpikeFile {
  generated_at?: string;
  zones?: Record<string, SpikeZone>;
}

const SPIKE_PATH = resolve(__dirname, '../../../../osm_spike/waltham_forest_cpz_hours.json');
const OUT_PATH = resolve(__dirname, '../../../static-data/waltham-forest.json');

function build(): StaticDataFile {
  const spike = JSON.parse(readFileSync(SPIKE_PATH, 'utf8')) as SpikeFile;
  const entries = Object.entries(spike.zones ?? {});
  const zones: StaticZone[] = entries.map(([code, z]) => ({
    code: (z.osm_zone_tag ?? code).trim(),
    name: z.zone_name?.trim() || null,
    hours: z.hours_osm_syntax?.trim() || null,
    note: z.note?.trim() || null,
    provenance: z.source?.trim() || null,
  }));
  zones.sort((a, b) => a.code.localeCompare(b.code));

  return parseStaticDataFile({
    borough: 'waltham_forest',
    displayBorough: 'London Borough of Waltham Forest',
    join: 'osm_zone_tag',
    sourceType: 'waltham_forest_static',
    generatedAt: spike.generated_at ?? new Date().toISOString().slice(0, 10),
    source:
      'Waltham Forest council CPZ map PDFs — hours extracted via the osm_spike pipeline ' +
      '(pdftotext / tesseract OCR / Claude vision / web search); see osm_spike/README.md. ' +
      'Streets join to these zones via OSM parking:*:zone=* tags.',
    zones,
  });
}

function main(): void {
  const file = build();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(file, null, 2) + '\n');
  const withHours = file.zones.filter((z) => z.hours).length;
  console.log(`[build-wf-static] wrote ${file.zones.length} zones (${withHours} with hours) → ${OUT_PATH}`);
}

if (require.main === module) main();
