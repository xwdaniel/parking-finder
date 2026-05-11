// Build backend/static-data/tower-hamlets.json (build-order step 4b).
//
// Tower Hamlets publishes no machine-readable CPZ feed. The 16 mini-zones were
// recently consolidated under 4 parent zones (A Bethnal Green / B Bow-Poplar /
// C Stepney-Wapping / D Isle of Dogs); hours vary per mini-zone. Sources:
//   - towerhamlets.gov.uk/.../Parking_zones.aspx (per-mini-zone table)
//   - Controlled-Parking-Zones-Within-Tower-Hamlets.pdf (CPZ map with text labels)
//   - cross-check: towerhamlets.traffweb.app (Traffic Management Orders) — authoritative
// (all fetched 2026-05-11).
//
// Hours are hand-converted from council prose to OSM opening_hours syntax (the
// format is too irregular for a parser at this size). Three named sub-areas whose
// hours differ from their parent are split into their own codes (A6 Brick Lane West,
// B3 Chrisp Street, C2 Trinity Square) so the polygon step (4c) can give each its
// own boundary. To refresh: update RAW_ROWS and re-run:
//
//   npm run build:static-data:tower-hamlets   (or:  tsx src/ingestion/scripts/build-tower-hamlets-static.ts)

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { parseStaticDataFile, type StaticDataFile, type StaticZone } from '../static';

const OUT_PATH = resolve(__dirname, '../../../static-data/tower-hamlets.json');
const FETCHED = '2026-05-11';

/** name | code | OSM opening_hours (restricted window) | note (or null). */
const RAW_ROWS: ReadonlyArray<readonly [name: string, code: string, hours: string | null, note: string | null]> = [
  ['Zone A1 (Bethnal Green)', 'A1', 'Mo-Fr 08:30-17:30; Su 08:30-14:00', null],
  ['Zone A2 (Bethnal Green)', 'A2', 'Mo-Fr 08:30-17:30; Su 08:30-14:00', null],
  ['Zone A3 (Bethnal Green)', 'A3', 'Mo-Sa 08:30-17:30', null],
  ['Zone A4 (Bethnal Green)', 'A4', 'Mo-Fr 08:30-17:30', null],
  ['Zone A5 (Bethnal Green)', 'A5', 'Mo 00:00-19:00; Tu-We 08:30-19:00; Th 08:30-24:00; Fr-Su 00:00-24:00',
    'Unusual schedule — effectively restricted ~Thu 08:30 through Mon 19:00, plus Tue/Wed daytime. Verify against towerhamlets.traffweb.app.'],
  ['Zone A6 (Bethnal Green)', 'A6', 'Mo-Fr 08:30-19:00; Su 08:30-14:00',
    'The resident-only bays west of Brick Lane operate Mo-Su 08:30-22:00 — see "A6 Brick Lane West".'],
  ['Zone A6 — Brick Lane (west) resident bays', 'A6 Brick Lane West', 'Mo-Su 08:30-22:00',
    'Resident permit holders only, west of Brick Lane. The Brick Lane / Sclater Street Sunday market may bring separate bay suspensions — verify on the ground.'],
  ['Zone B1 (Bow / Poplar)', 'B1', 'Mo-Sa 08:30-17:30', null],
  ['Zone B2 (Bow / Poplar)', 'B2', 'Mo-Fr 08:30-17:30', null],
  ['Zone B3 (Bow / Poplar)', 'B3', 'Mo-Fr 08:30-17:30',
    'The Chrisp Street area within B3 operates Mo-Sa 08:30-17:30 — see "B3 Chrisp Street".'],
  ['Zone B3 — Chrisp Street', 'B3 Chrisp Street', 'Mo-Sa 08:30-17:30', null],
  ['Zone B4 (Bow / Poplar)', 'B4', 'Mo-Sa 08:30-19:30',
    'Plus event-day Sundays 08:30-19:30 on London Stadium fixture days.'],
  ['Zone C1 (Stepney / Wapping)', 'C1', 'Mo-Fr 08:30-17:30', null],
  ['Zone C2 (Stepney / Wapping)', 'C2', 'Mo-Fr 08:30-17:30',
    'The Trinity Square area within C2 operates Mo-Sa 08:30-17:30 + Su 08:30-14:00 — see "C2 Trinity Square".'],
  ['Zone C2 — Trinity Square', 'C2 Trinity Square', 'Mo-Sa 08:30-17:30; Su 08:30-14:00', null],
  ['Zone C3 (Stepney / Wapping)', 'C3', 'Mo-Fr 08:30-17:30', null],
  ['Zone C4 (Stepney / Wapping)', 'C4', 'Mo-Fr 08:30-17:30', null],
  ['Zone D1 (Isle of Dogs)', 'D1', 'Mo-Fr 08:30-17:30', null],
  ['Zone D2 (Isle of Dogs)', 'D2', 'Mo-Fr 08:30-17:30', null],
];

function build(): StaticDataFile {
  const zones: StaticZone[] = RAW_ROWS.map(([name, code, hours, note]) => ({
    code,
    name,
    hours,
    note,
    provenance: 'towerhamlets council parking-zones page + CPZ map PDF',
  }));
  zones.sort((a, b) => a.code.localeCompare(b.code));

  return parseStaticDataFile({
    borough: 'tower_hamlets',
    displayBorough: 'London Borough of Tower Hamlets',
    join: 'polygon',
    sourceType: 'tower_hamlets_static',
    generatedAt: FETCHED,
    source:
      `Tower Hamlets council parking-zones page + Controlled-Parking-Zones-Within-Tower-Hamlets.pdf (fetched ${FETCHED}). ` +
      'The 16 mini-zones (A1–A6, B1–B4, C1–C4, D1–D2) were recently consolidated under 4 parent zones; this list over-splits ' +
      'three named sub-areas (A6 Brick Lane West, B3 Chrisp Street, C2 Trinity Square) into their own codes because their hours ' +
      'differ from the parent zone. Hours hand-converted from council prose to OSM opening_hours syntax — cross-check against ' +
      'towerhamlets.traffweb.app (Traffic Management Orders, authoritative). Hours only — no machine-readable polygons; the ' +
      'street→zone join needs polygons sourced separately (build-order step 4c). Free outside CPZ hours and on bank holidays.',
    zones,
  });
}

function main(): void {
  const file = build();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(file, null, 2) + '\n');
  const withHours = file.zones.filter((z) => z.hours).length;
  console.log(`[build-tower-hamlets-static] wrote ${file.zones.length} zones (${withHours} with hours) → ${OUT_PATH}`);
}

if (require.main === module) main();
