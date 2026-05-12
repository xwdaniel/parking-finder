import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateZone, type MatchedCpz, type ZoneEval } from './inclusion';

const zone = (over: Partial<ZoneEval>): ZoneEval => ({
  borough: 'camden',
  osmZoneTag: null,
  onRedRoute: false,
  matchedCpz: [],
  inCpzArea: false,
  boroughHoursSpread: null,
  ...over,
});

const cpz = (over: Partial<MatchedCpz>): MatchedCpz => ({
  sourceZoneId: 'Z',
  displayName: 'Zone Z',
  hours: 'Mo-Fr 09:00-17:00',
  activity: 'inactive',
  ...over,
});

test('a zone on a Red Route is excluded regardless of borough or CPZ state', () => {
  const r = evaluateZone(zone({ borough: 'camden', onRedRoute: true, matchedCpz: [cpz({ activity: 'inactive' })] }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'red_route');
});

test('an active CPZ excludes the zone and reports which one', () => {
  const r = evaluateZone(zone({
    matchedCpz: [cpz({ sourceZoneId: 'CA-N', displayName: 'CA-N Camden Square', hours: 'Mo-Fr 09:00-17:00', activity: 'active' })],
  }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'active_cpz');
  assert.deepEqual(r.activeCpz, { sourceZoneId: 'CA-N', displayName: 'CA-N Camden Square', hours: 'Mo-Fr 09:00-17:00' });
});

test('among several matched CPZs, any one operational excludes the zone', () => {
  const r = evaluateZone(zone({
    matchedCpz: [cpz({ sourceZoneId: 'A', activity: 'inactive' }), cpz({ sourceZoneId: 'B', activity: 'active', hours: 'Mo-Su 00:00-24:00' })],
  }));
  assert.equal(r.eligible, false);
  assert.equal(r.activeCpz?.sourceZoneId, 'B');
});

test('a Camden zone outside every CPZ is eligible at confidence 1.0', () => {
  const r = evaluateZone(zone({ borough: 'camden' }));
  assert.deepEqual([r.eligible, r.confidence, r.reason], [true, 1.0, 'free']);
});

test('a Camden zone in a CPZ that is off right now is eligible at 1.0 with the governing hours', () => {
  const r = evaluateZone(zone({ borough: 'camden', matchedCpz: [cpz({ hours: 'Mo-Fr 08:30-18:30; Sa 09:30-13:30', activity: 'inactive' })] }));
  assert.deepEqual(
    [r.eligible, r.confidence, r.reason, r.appliedHours],
    [true, 1.0, 'cpz_inactive', 'Mo-Fr 08:30-18:30; Sa 09:30-13:30'],
  );
});

test('a Waltham Forest zone whose OSM zone tag resolves to known, off hours → 0.8 with those hours', () => {
  const r = evaluateZone(zone({
    borough: 'waltham_forest',
    osmZoneTag: 'WSE',
    matchedCpz: [cpz({ sourceZoneId: 'WSE', hours: 'Mo-Fr 10:00-16:00', activity: 'inactive' })],
  }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.appliedHours], [true, 0.8, 'cpz_inactive', 'Mo-Fr 10:00-16:00']);
});

test('a Waltham Forest zone tagged with a zone code we have no catalogue row for → 0.6, verify with signage', () => {
  const r = evaluateZone(zone({ borough: 'waltham_forest', osmZoneTag: 'XYZ', matchedCpz: [] }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.zoneUnknown], [true, 0.6, 'cpz_unknown', true]);
});

test('a Waltham Forest zone whose matched CPZ row has null hours → 0.6, verify with signage', () => {
  const r = evaluateZone(zone({
    borough: 'waltham_forest',
    osmZoneTag: 'WL',
    matchedCpz: [cpz({ sourceZoneId: 'WL', hours: null, activity: 'unknown' })],
  }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.zoneUnknown], [true, 0.6, 'cpz_unknown', true]);
});

test('a Waltham Forest zone with no OSM zone tag → eligible at the borough source tier 0.8', () => {
  const r = evaluateZone(zone({ borough: 'waltham_forest', osmZoneTag: null }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.zoneUnknown], [true, 0.8, 'free', false]);
});

test('a Haringey zone inside a borough CPZ-coverage polygon → 0.6 with the borough hours spread', () => {
  const r = evaluateZone(zone({
    borough: 'haringey',
    inCpzArea: true,
    boroughHoursSpread: ['Mo-Fr 08:30-18:30', 'Mo-Fr 10:00-12:00'],
  }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.zoneUnknown], [true, 0.6, 'in_cpz_area', true]);
  assert.deepEqual(r.hoursSpread, ['Mo-Fr 08:30-18:30', 'Mo-Fr 10:00-12:00']);
});

test('a Tower Hamlets zone outside every CPZ-coverage polygon → eligible at 0.8', () => {
  const r = evaluateZone(zone({ borough: 'tower_hamlets', inCpzArea: false }));
  assert.deepEqual([r.eligible, r.confidence, r.reason], [true, 0.8, 'free']);
});

test('a zone in a borough with no CPZ adapter → eligible at 0.4 with the warning flag', () => {
  const r = evaluateZone(zone({ borough: 'islington' }));
  assert.deepEqual([r.eligible, r.confidence, r.reason, r.boroughHasAdapter], [true, 0.4, 'no_adapter', false]);
});

test('a known, off CPZ wins over an also-matched row with unknown hours (we report the hours we have)', () => {
  const r = evaluateZone(zone({
    borough: 'camden',
    matchedCpz: [cpz({ sourceZoneId: 'KNOWN', hours: 'Mo-Fr 08:30-18:30', activity: 'inactive' }), cpz({ sourceZoneId: 'MURKY', hours: null, activity: 'unknown' })],
  }));
  assert.deepEqual([r.reason, r.appliedHours, r.zoneUnknown], ['cpz_inactive', 'Mo-Fr 08:30-18:30', false]);
});
