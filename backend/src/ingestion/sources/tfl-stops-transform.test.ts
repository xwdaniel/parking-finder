import test from 'node:test';
import assert from 'node:assert/strict';

import { projectStopPoint, projectStopPoints } from './tfl-stops-transform';

test('projectStopPoint keeps a Tube station with valid coords', () => {
  const r = projectStopPoint({
    id: '940GZZLUCND',
    naptanId: '940GZZLUCND',
    commonName: 'Camden Town Underground Station',
    stopType: 'NaptanMetroStation',
    modes: ['tube'],
    lat: 51.5392,
    lon: -0.1426,
  });
  assert.deepEqual(r, { id: '940GZZLUCND', name: 'Camden Town Underground Station', modes: ['tube'], lat: 51.5392, lng: -0.1426 });
});

test('projectStopPoint drops national-rail-only stations (we route on tube/dlr/og/elizabeth)', () => {
  const r = projectStopPoint({ id: 'A', commonName: 'Generic Rail', modes: ['national-rail'], lat: 51, lon: -0.1 });
  assert.equal(r, null);
});

test('projectStopPoint keeps the intersection of station.modes ∩ routed modes', () => {
  const r = projectStopPoint({ id: 'B', commonName: 'Stratford', modes: ['tube', 'dlr', 'overground', 'elizabeth-line', 'national-rail', 'bus'], lat: 51.5417, lon: -0.0033 });
  assert.deepEqual(r?.modes, ['tube', 'dlr', 'overground', 'elizabeth-line']);
});

test('projectStopPoint rejects rows without coords or a name', () => {
  assert.equal(projectStopPoint({ id: 'C', commonName: 'X', modes: ['tube'] }), null);
  assert.equal(projectStopPoint({ id: 'C', modes: ['tube'], lat: 51, lon: -0.1 }), null);
  assert.equal(projectStopPoint({ commonName: 'X', modes: ['tube'], lat: 51, lon: -0.1 }), null);
});

test('projectStopPoints dedupes by id (TfL sometimes re-lists across pages)', () => {
  const rs = projectStopPoints([
    { id: 'X', commonName: 'X Station', modes: ['tube'], lat: 51, lon: -0.1 },
    { id: 'X', commonName: 'X Station (dup)', modes: ['tube'], lat: 51, lon: -0.1 },
    { id: 'Y', commonName: 'Y Station', modes: ['dlr'], lat: 51.5, lon: -0.05 },
  ]);
  assert.equal(rs.length, 2);
  assert.deepEqual(rs.map((r) => r.id).sort(), ['X', 'Y']);
});
