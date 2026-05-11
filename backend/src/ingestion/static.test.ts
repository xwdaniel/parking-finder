import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStaticDataFile, staticZonesToCpzRecords, loadStaticDataFile, type StaticDataFile } from './static';

const VALID: unknown = {
  borough: 'waltham_forest',
  displayBorough: 'London Borough of Waltham Forest',
  join: 'osm_zone_tag',
  sourceType: 'waltham_forest_static',
  generatedAt: '2026-05-10',
  source: 'council PDF maps',
  zones: [
    { code: 'WSE', name: 'Wood Street East', hours: 'Mo-Fr 10:00-16:00', note: null, provenance: 'pdftotext' },
    { code: 'WXS(w)', name: null, hours: null, note: 'PDF had no hours text', provenance: null },
  ],
};

test('parseStaticDataFile — accepts a well-formed file and normalises optional fields', () => {
  const f = parseStaticDataFile(VALID);
  assert.equal(f.borough, 'waltham_forest');
  assert.equal(f.join, 'osm_zone_tag');
  assert.equal(f.zones.length, 2);
  assert.deepEqual(f.zones[1], { code: 'WXS(w)', name: null, hours: null, note: 'PDF had no hours text', provenance: null });
});

test('parseStaticDataFile — rejects structural problems', () => {
  assert.throws(() => parseStaticDataFile(null));
  assert.throws(() => parseStaticDataFile({ ...(VALID as object), join: 'whatever' }));
  assert.throws(() => parseStaticDataFile({ ...(VALID as object), zones: 'nope' }));
  assert.throws(() => parseStaticDataFile({ ...(VALID as object), borough: 123 }));
  assert.throws(() =>
    parseStaticDataFile({ ...(VALID as object), zones: [{ code: '', name: null, hours: null, note: null, provenance: null }] }),
  );
  assert.throws(() =>
    parseStaticDataFile({
      ...(VALID as object),
      zones: [
        { code: 'A', name: null, hours: null, note: null, provenance: null },
        { code: 'A', name: null, hours: null, note: null, provenance: null },
      ],
    }),
  );
});

test('staticZonesToCpzRecords — one cpz row per zone, slugged id, null geometry, hours passed through', () => {
  const f = parseStaticDataFile(VALID) as StaticDataFile;
  const recs = staticZonesToCpzRecords(f);
  assert.equal(recs.length, 2);

  const wse = recs[0];
  assert.ok(wse);
  assert.equal(wse.id, 'waltham_forest:wse');
  assert.equal(wse.borough, 'waltham_forest');
  assert.equal(wse.sourceZoneId, 'WSE');
  assert.equal(wse.displayName, 'Wood Street East');
  assert.equal(wse.hours, 'Mo-Fr 10:00-16:00');
  assert.equal(wse.sourceType, 'waltham_forest_static');
  assert.deepEqual(wse.geomGeoJson, []);

  const wxsw = recs[1];
  assert.ok(wxsw);
  assert.equal(wxsw.id, 'waltham_forest:wxs-w'); // parens slugged away
  assert.equal(wxsw.sourceZoneId, 'WXS(w)'); // join key kept verbatim
  assert.equal(wxsw.hours, null);
});

// Regression guard: the committed static-data files (built by `npm run build:static-data`)
// must parse and look sane. Catches a build script emitting garbage.
const COMMITTED_FILES = ['waltham-forest.json', 'haringey.json', 'tower-hamlets.json'] as const;
const DAY_TOKEN_RE = /\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/;
const TIME_RANGE_RE = /\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/;

for (const fileName of COMMITTED_FILES) {
  test(`static-data/${fileName} is valid and every catalogued zone has plausible hours`, () => {
    const file = loadStaticDataFile(fileName); // throws if structurally invalid
    assert.ok(file.zones.length > 0, 'expected at least one zone');
    assert.ok(file.join === 'osm_zone_tag' || file.join === 'polygon');
    for (const z of file.zones) {
      if (z.hours == null) continue;
      assert.match(z.hours, DAY_TOKEN_RE, `${fileName} ${z.code}: hours missing a day token`);
      assert.match(z.hours, TIME_RANGE_RE, `${fileName} ${z.code}: hours missing a HH:MM-HH:MM range`);
    }
    // ids are unique once slugged → cpz primary key holds
    const recs = staticZonesToCpzRecords(file);
    assert.equal(new Set(recs.map((r) => r.id)).size, recs.length, `${fileName}: slugged ids collide`);
  });
}
