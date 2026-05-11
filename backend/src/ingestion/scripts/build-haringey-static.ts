// Build backend/static-data/haringey.json from the council's published list at
// https://www.haringey.gov.uk/parking/cpzs/all-cpz-hours (fetched 2026-05-11).
// The raw council strings live in RAW_ROWS below; haringeyHours() normalises them
// to OSM opening_hours syntax. To refresh, update RAW_ROWS from the live page and
// re-run:
//
//   npm run build:static-data:haringey   (or:  tsx src/ingestion/scripts/build-haringey-static.ts)
//
// NB: this file carries hours only — Haringey publishes no machine-readable zone
// polygons, so the street→zone join is via spatial intersection once polygons are
// sourced separately (build-order step 4c). `join` is therefore 'polygon'.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { haringeyHours } from '../hours';
import { parseStaticDataFile, type StaticDataFile, type StaticZone } from '../static';

const OUT_PATH = resolve(__dirname, '../../../static-data/haringey.json');
const FETCHED = '2026-05-11';

/** name | code(s) | raw council "operational hours" string. Slash-separated codes are split. */
const RAW_ROWS: ReadonlyArray<readonly [name: string, codes: string, raw: string]> = [
  ['Alexandra Palace', 'AP', 'Mon-Fri 12pm-2pm'],
  ['Belmont', 'B', 'Mon-Fri 8am-6:30pm'],
  ['Bounds Green', 'BG', 'Mon-Fri 10am-12pm'],
  ['Bounds Green East', 'BGE', 'Mon-Fri 11am-1pm'],
  ['Bruce Castle', 'BC', 'Mon-Sat 8am-6:30pm (non-event); event days vary'],
  ['Bruce Grove North', 'BGN', 'Mon-Sat 8am-6:30pm (non-event); event days vary'],
  ['Bruce Grove West', 'BGW', 'Mon-Fri 2pm-4pm'],
  ['Crouch End A', 'CEA', 'Mon-Fri 10am-12pm'],
  ['Crouch End B', 'CEB', 'Mon-Fri 2pm-4pm'],
  ['Finsbury Park', 'FP/FPB/FPC', 'Mon-Sat 8:30am-6:30pm (non-event); event days vary'],
  ['Fortis Green', 'FG', 'Mon-Fri 11am-1pm'],
  ['Green Lanes Zone A', 'GLA', 'Mon-Sat 8am-6:30pm'],
  ['Green Lanes Zone B', 'GLB', 'Mon-Fri 8am-6:30pm'],
  ['Highgate', 'HGA', 'Mon-Fri 10am-12pm'],
  ['Highgate Station', 'HGSTA', 'Mon-Fri 10am-12pm (varies by sub-zone)'],
  ['Highgate Station Outer', 'HGSTA O', 'Mon-Fri 10am-12pm'],
  ['Hornsey North', 'HN', 'Mon-Fri 8am-6:30pm'],
  ['Hornsey North East', 'HNE', 'Mon-Fri 10am-2pm'],
  ['Hornsey South', 'HS', 'Mon-Fri 11am-1pm'],
  ['Jarrow Road', 'JR', 'Mon-Sat 8am-6:30pm'],
  ['Muswell Hill', 'MH', 'Mon-Sun 11am-1pm'],
  ['Muswell Hill West', 'MHW', 'Mon-Fri 10am-2pm'],
  ['Myddleton Road Stop & Shop', 'MR', 'Mon-Sat 9am-6pm'],
  ['Northumberland Park West', 'NPW', 'Mon-Fri 8am-8pm (non-event); event days vary'],
  ["St Ann's", 'SA', 'Mon-Sat 8am-6:30pm'],
  ["St Luke's", 'SL', 'Mon-Fri 11am-1pm'],
  ['Seven Sisters', '7S', 'Mon-Sat 8am-6:30pm'],
  ['Seven Sisters South', '7SS', 'Mon-Fri 8am-6:30pm'],
  ['South Tottenham', 'ST', 'Mon-Fri 10am-12pm'],
  ['Stroud Green', 'SG', 'Mon-Fri 12pm-2pm'],
  ['The Hale', 'TH', 'Mon-Fri 8:30am-6:30pm (non-event); event days vary'],
  ['Tottenham Hale North', 'THN', 'Mon-Sun 8am-6:30pm (non-event); event days vary'],
  ['Tottenham Hale North Event Day', 'THNED', 'Event-only zone'],
  ['Tottenham Event Day', 'TED', 'Event-only zone'],
  ['Tottenham North', 'TN', 'Mon-Sat 8am-6:30pm (non-event); event days vary'],
  ['Tower Gardens', 'TG', 'Mon-Sun 8am-6:30pm (non-event); varied hours for Walpole Road sub-zone'],
  ['Tower Gardens Event Day', 'TGED', 'Event-only zone'],
  ['White Hart Lane', 'WHL', 'Mon-Sun 8am-6:30pm (non-event); event days vary'],
  ['Willoughby Lane', 'WL', 'Mon-Fri 8am-6:30pm (non-event); event days vary'],
  ['Wood Green Inner Zone', 'WG', 'Mon-Sun 8am-10pm'],
  ['Wood Green Outer Zone', 'WG-O', 'Mon-Sat 8am-6:30pm'],
  ['Woodside', 'WS', 'Mon-Fri 8am-6:30pm'],
  ['Woodside West', 'WW', 'Mon-Fri 11am-1pm'],
];

function build(): StaticDataFile {
  const zones: StaticZone[] = [];
  for (const [name, codes, raw] of RAW_ROWS) {
    const { hours, note } = haringeyHours(raw);
    for (const code of codes.split('/').map((c) => c.trim()).filter(Boolean)) {
      zones.push({ code, name, hours, note, provenance: 'haringey council all-cpz-hours page' });
    }
  }
  zones.sort((a, b) => a.code.localeCompare(b.code));

  return parseStaticDataFile({
    borough: 'haringey',
    displayBorough: 'London Borough of Haringey',
    join: 'polygon',
    sourceType: 'haringey_static',
    generatedAt: FETCHED,
    source:
      `https://www.haringey.gov.uk/parking/cpzs/all-cpz-hours (fetched ${FETCHED}). ` +
      'Hours only — Haringey publishes no machine-readable zone polygons; the street→zone ' +
      'join needs polygons sourced separately (build-order step 4c). Free outside CPZ hours ' +
      'and on bank holidays; several zones near Spurs stadium have extended event-day hours.',
    zones,
  });
}

function main(): void {
  const file = build();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(file, null, 2) + '\n');
  const withHours = file.zones.filter((z) => z.hours).length;
  console.log(`[build-haringey-static] wrote ${file.zones.length} zones (${withHours} with hours) → ${OUT_PATH}`);
}

if (require.main === module) main();
