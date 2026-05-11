import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { featureCollectionToAreaRecords } from './cpz-areas-transform';

const poly = (n: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[0, 0], [0, n], [n, n], [n, 0], [0, 0]]],
});
const fc = (geoms: Array<{ type: string; coordinates: unknown }>) => ({
  type: 'FeatureCollection' as const,
  features: geoms.map((geometry) => ({ type: 'Feature', geometry, properties: {} })),
});

test('featureCollectionToAreaRecords — maps each (Multi)Polygon feature to a CpzAreaRecord with an indexed id', () => {
  const recs = featureCollectionToAreaRecords(
    fc([poly(1), { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 2], [2, 2], [0, 0]]]] }]),
    'haringey',
    'felt_2024',
  );
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.id), ['felt_2024:haringey:0', 'felt_2024:haringey:1']);
  assert.equal(recs[0]?.borough, 'haringey');
  assert.equal(recs[0]?.sourceType, 'felt_2024');
  assert.ok(recs[0]?.geomGeoJson.startsWith('{"type":"Polygon"'));
  assert.ok(recs[1]?.geomGeoJson.startsWith('{"type":"MultiPolygon"'));
});

test('featureCollectionToAreaRecords — rejects non-FeatureCollections and non-polygon features', () => {
  assert.throws(() => featureCollectionToAreaRecords(null, 'x', 'felt_2024'));
  assert.throws(() => featureCollectionToAreaRecords({ type: 'Feature' }, 'x', 'felt_2024'));
  assert.throws(() =>
    featureCollectionToAreaRecords(
      { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] },
      'x',
      'felt_2024',
    ),
  );
});

// Smoke test for the committed Felt polygon files, when present (after `npm run fetch:felt-cpz`).
const STATIC_DIR = resolve(__dirname, '../../../static-data');
for (const [borough, file] of [
  ['haringey', 'haringey-cpz-polygons.geojson'],
  ['tower_hamlets', 'tower-hamlets-cpz-polygons.geojson'],
] as const) {
  test(`static-data/${file} parses to area records${existsSync(resolve(STATIC_DIR, file)) ? '' : ' (skipped — file not present)'}`, { skip: !existsSync(resolve(STATIC_DIR, file)) }, () => {
    const recs = featureCollectionToAreaRecords(JSON.parse(readFileSync(resolve(STATIC_DIR, file), 'utf8')), borough, 'felt_2024');
    assert.ok(recs.length > 0, `${file}: expected at least one polygon`);
    assert.equal(new Set(recs.map((r) => r.id)).size, recs.length);
  });
}
