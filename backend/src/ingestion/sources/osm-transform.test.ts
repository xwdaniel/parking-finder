import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractParkingLane,
  extractParkingCondition,
  extractZoneTag,
  wayToZoneFeature,
  waysToFeatureCollection,
  type OverpassWay,
} from './osm-transform';

test('extractParkingLane — first positive value across the known keys, else null', () => {
  assert.equal(extractParkingLane({ 'parking:lane:left': 'parallel' }), 'parallel');
  assert.equal(extractParkingLane({ 'parking:lane:both': 'diagonal', 'parking:lane:left': 'parallel' }), 'diagonal'); // :both checked first
  assert.equal(extractParkingLane({ 'parking:left:orientation': 'perpendicular' }), 'perpendicular');
  assert.equal(extractParkingLane({ 'parking:left': 'street_side' }), 'street_side');
  assert.equal(extractParkingLane({ 'parking:lane:left': 'no' }), null); // not a positive value
  assert.equal(extractParkingLane({ highway: 'residential' }), null);
});

test('extractParkingCondition — first recognised condition value, else null', () => {
  assert.equal(extractParkingCondition({ 'parking:condition:both': 'residents' }), 'residents');
  assert.equal(extractParkingCondition({ 'parking:left:restriction': 'permit' }), 'permit');
  assert.equal(extractParkingCondition({ 'parking:condition:right': 'free' }), 'free');
  assert.equal(extractParkingCondition({ 'parking:lane:left': 'parallel' }), null); // not a condition key/value
  assert.equal(extractParkingCondition({}), null);
});

test('extractZoneTag — value of the first parking:*:zone key, first ";" segment, trimmed', () => {
  assert.equal(extractZoneTag({ 'parking:both:zone': 'WSE' }), 'WSE');
  assert.equal(extractZoneTag({ 'parking:condition:left:zone': 'CA-N' }), 'CA-N');
  assert.equal(extractZoneTag({ 'parking:both:zone': 'A;B' }), 'A');
  assert.equal(extractZoneTag({ 'parking:both:zone': '  WXS(w) ' }), 'WXS(w)');
  assert.equal(extractZoneTag({ name: 'Foo Road' }), null);
});

test('wayToZoneFeature — builds a [lon,lat] LineString Feature with the attribute tuple; drops <2-coord ways', () => {
  const way: OverpassWay = {
    type: 'way',
    id: 12345,
    tags: { name: 'Acacia Avenue', 'parking:lane:left': 'parallel', 'parking:both:zone': 'WSE' },
    geometry: [
      { lat: 51.5, lon: -0.1 },
      { lat: 51.501, lon: -0.101 },
    ],
  };
  const f = wayToZoneFeature(way, 'waltham_forest');
  assert.ok(f);
  assert.equal(f.properties.way_id, '12345');
  assert.equal(f.properties.borough, 'waltham_forest');
  assert.equal(f.properties.street_name, 'Acacia Avenue');
  assert.equal(f.properties.parking_lane, 'parallel');
  assert.equal(f.properties.parking_condition, null);
  assert.equal(f.properties.osm_zone_tag, 'WSE');
  assert.deepEqual(f.geometry, { type: 'LineString', coordinates: [[-0.1, 51.5], [-0.101, 51.501]] });

  assert.equal(wayToZoneFeature({ type: 'way', id: 1, geometry: [{ lat: 0, lon: 0 }] }, 'camden'), null);
  assert.equal(wayToZoneFeature({ type: 'way', id: 2 }, 'camden'), null);
});

test('waysToFeatureCollection — keeps only valid way features', () => {
  const fc = waysToFeatureCollection(
    [
      { type: 'way', id: 1, tags: { name: 'A' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] },
      { type: 'way', id: 2, geometry: [{ lat: 0, lon: 0 }] }, // dropped (1 coord)
    ],
    'camden',
  );
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0]?.properties.way_id, '1');
});
