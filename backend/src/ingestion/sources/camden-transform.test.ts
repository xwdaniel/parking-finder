import test from 'node:test';
import assert from 'node:assert/strict';

import { transformCamdenZones, transformCamdenBays } from './camden-transform';

const poly = (n: number) => ({ type: 'Polygon', coordinates: [[[0, 0], [0, n], [n, n], [0, 0]]] });

test('transformCamdenZones — groups sub-zone polygons by name, derives hours', () => {
  const rows = [
    // CA-B Belsize spans two polygons that share a name + hours → one record, two geoms.
    { controlled_parking_zone_code: 'CAB', controlled_parking_zone_name: 'CA-B Belsize', control_monday_to_friday: '09:00-18:30', control_saturday: '09:30-13:30', location: poly(1) },
    { controlled_parking_zone_code: 'CAB', controlled_parking_zone_name: 'CA-B Belsize', control_monday_to_friday: '09:00-18:30', control_saturday: '09:30-13:30', location: poly(2) },
    { controlled_parking_zone_code: 'CAF', controlled_parking_zone_name: 'CA-F(n) Camden Town Area', control_monday_to_friday: '08:30-23:00', control_saturday: '09:30-23:00', location: poly(3) },
    { controlled_parking_zone_code: 'CAN', controlled_parking_zone_name: 'CA-N Camden Square', control_monday_to_friday: '08:30-18:30', control_saturday: '', location: poly(4) },
    { controlled_parking_zone_code: 'CAG', controlled_parking_zone_name: 'CA-G(Crown) Crown Estate', control_monday_to_friday: '00:00-23:59', control_saturday: '00:00-23:59', location: poly(5) },
    { controlled_parking_zone_name: '   ', location: poly(6) }, // blank name → dropped
  ];
  const out = transformCamdenZones(rows);
  const byId = new Map(out.map((r) => [r.id, r]));
  assert.equal(out.length, 4);

  const belsize = byId.get('camden:ca-b-belsize');
  assert.ok(belsize);
  assert.equal(belsize.sourceZoneId, 'CA-B Belsize');
  assert.equal(belsize.displayName, 'CA-B Belsize');
  assert.equal(belsize.borough, 'camden');
  assert.equal(belsize.sourceType, 'camden_socrata');
  assert.equal(belsize.geomGeoJson.length, 2);
  assert.equal(belsize.hours, 'Mo-Fr 09:00-18:30; Sa 09:30-13:30');
  assert.ok(belsize.geomGeoJson[0]?.startsWith('{"type":"Polygon"'));

  assert.equal(byId.get('camden:ca-f-n-camden-town-area')?.hours, 'Mo-Fr 08:30-23:00; Sa 09:30-23:00');
  assert.equal(byId.get('camden:ca-n-camden-square')?.hours, 'Mo-Fr 08:30-18:30');
  assert.equal(byId.get('camden:ca-g-crown-crown-estate')?.hours, 'Mo-Fr 00:00-24:00; Sa 00:00-24:00');
});

test('transformCamdenBays — maps fields, handles missing uid / geometry', () => {
  const rows = [
    {
      unique_identifier: '46133904',
      controlled_parking_zone: 'CA-E',
      road_name: 'Fitzroy Street',
      restriction_type: 'paid-for',
      times_of_operation: 'mon-sat 08:30-18:30',
      epsg_4326_geojson_geometry: '{"type":"LineString","coordinates":[[-0.14,51.52],[-0.141,51.521]]}',
    },
    { unique_identifier: '999', controlled_parking_zone: 'CA-B', times_of_operation: 'at any time' }, // no geometry
    { controlled_parking_zone: 'CA-X' }, // no uid → dropped
  ];
  const out = transformCamdenBays(rows);
  assert.equal(out.length, 2);

  const a = out[0];
  assert.ok(a);
  assert.equal(a.id, 'camden:46133904');
  assert.equal(a.source, 'camden_socrata');
  assert.equal(a.borough, 'camden');
  assert.equal(a.sourceZoneCode, 'CA-E');
  assert.equal(a.roadName, 'Fitzroy Street');
  assert.equal(a.restrictionType, 'paid-for');
  assert.equal(a.timesOfOperation, 'mon-sat 08:30-18:30');
  assert.ok(a.geomGeoJson?.includes('LineString'));

  const b = out[1];
  assert.ok(b);
  assert.equal(b.id, 'camden:999');
  assert.equal(b.geomGeoJson, null);
  assert.equal(b.timesOfOperation, 'at any time');
});
