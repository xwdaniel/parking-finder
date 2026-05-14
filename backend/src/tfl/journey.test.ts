import test from 'node:test';
import assert from 'node:assert/strict';

import { _internals } from './journey';

const { snap50m, bucket5min, normalize } = _internals;

test('snap50m rounds two close coords to the same key (~50m grid, brief §9)', () => {
  // Wrotham Road, Camden — two points ~10m apart should snap to one cell.
  const a = snap50m(51.5417, -0.13546);
  const b = snap50m(51.5418, -0.13540);
  assert.equal(a, b);
});

test('snap50m: points >100m apart end up in different cells', () => {
  const a = snap50m(51.5417, -0.1354);
  const b = snap50m(51.5450, -0.1350); // ~370m north
  assert.notEqual(a, b);
});

test('bucket5min: two times <5min apart round to the same bucket', () => {
  const a = bucket5min(new Date(2026, 4, 14, 21, 3, 0));
  const b = bucket5min(new Date(2026, 4, 14, 21, 4, 30));
  assert.equal(a, b);
});

test('bucket5min: 5-min boundary jumps the bucket', () => {
  const a = bucket5min(new Date(2026, 4, 14, 21, 4, 59));
  const b = bucket5min(new Date(2026, 4, 14, 21, 5, 0));
  assert.notEqual(a, b);
});

test('normalize: a typical 3-leg tube journey collapses to walk / transit / total minutes', () => {
  const j = normalize({
    journeys: [
      {
        startDateTime: '2026-05-14T22:05:00',
        arrivalDateTime: '2026-05-14T22:38:00',
        duration: 33,
        legs: [
          { mode: { name: 'walking' }, duration: 13, instruction: { summary: 'Walk to Camden Town Station' }, departurePoint: { commonName: 'A' }, arrivalPoint: { commonName: 'Camden Town' } },
          { mode: { name: 'tube' }, duration: 9, instruction: { summary: 'Northern line' }, departurePoint: { commonName: 'Camden Town' }, arrivalPoint: { commonName: 'Charing Cross' }, disruptions: [{ description: 'Minor delays.' }] },
          { mode: { name: 'walking' }, duration: 11, instruction: { summary: 'Walk to destination' }, departurePoint: { commonName: 'Charing Cross' }, arrivalPoint: { commonName: 'B' } },
        ],
      },
    ],
  });
  assert.equal(j?.totalMinutes, 33);
  assert.equal(j?.walkToStopMinutes, 13);
  assert.equal(j?.walkFromStopMinutes, 11);
  assert.equal(j?.transitMinutes, 9);
  assert.equal(j?.disruption, 'minor');
  assert.equal(j?.legs.length, 3);
});

test('normalize: a Severe disruption on a transit leg propagates to the journey', () => {
  const j = normalize({
    journeys: [
      {
        duration: 40,
        legs: [
          { mode: { name: 'walking' }, duration: 5 },
          { mode: { name: 'tube' }, duration: 30, disruptions: [{ description: 'Severe delays due to signal failure.' }] },
          { mode: { name: 'walking' }, duration: 5 },
        ],
      },
    ],
  });
  assert.equal(j?.disruption, 'severe');
});

test('normalize: returns null when TfL gives no journeys', () => {
  assert.equal(normalize({ journeys: [] }), null);
  assert.equal(normalize({}), null);
});

test('normalize: extracts lineId + lineName from routeOptions for transit legs; walking legs get null', () => {
  const j = normalize({
    journeys: [
      {
        duration: 33,
        legs: [
          { mode: { name: 'walking' }, duration: 13, routeOptions: [{ name: '' }] },
          {
            mode: { name: 'tube' },
            duration: 9,
            routeOptions: [{ name: 'Northern', lineIdentifier: { id: 'northern', name: 'Northern' } }],
          },
          { mode: { name: 'walking' }, duration: 11 },
        ],
      },
    ],
  });
  assert.equal(j?.legs[0]!.lineId, null);
  assert.equal(j?.legs[0]!.lineName, null);
  assert.equal(j?.legs[1]!.lineId, 'northern');
  assert.equal(j?.legs[1]!.lineName, 'Northern');
  assert.equal(j?.legs[2]!.lineId, null);
});
