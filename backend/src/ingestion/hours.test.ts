import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTimeRanges, camdenHours, haringeyHours } from './hours';

test('parseTimeRanges', () => {
  assert.equal(parseTimeRanges('09:00-18:30'), '09:00-18:30');
  assert.equal(parseTimeRanges('8:00-9:00'), '08:00-09:00');
  assert.equal(parseTimeRanges('00:00-23:59'), '00:00-24:00');
  assert.equal(parseTimeRanges('08:00-09:00 & 15:00-17:00'), '08:00-09:00,15:00-17:00');
  assert.equal(parseTimeRanges('08:00-12:00, 14:30-18:30'), '08:00-12:00,14:30-18:30');
  assert.equal(parseTimeRanges('08:00 - 12:00'), '08:00-12:00');
  assert.equal(parseTimeRanges(''), null);
  assert.equal(parseTimeRanges('-'), null);
  assert.equal(parseTimeRanges('N/A'), null);
  assert.equal(parseTimeRanges('none'), null);
  assert.equal(parseTimeRanges(null), null);
  assert.equal(parseTimeRanges(undefined), null);
  assert.throws(() => parseTimeRanges('all day'));
  assert.throws(() => parseTimeRanges('25:00-26:00'));
});

test('camdenHours', () => {
  assert.equal(camdenHours('09:00-18:30', '09:30-13:30'), 'Mo-Fr 09:00-18:30; Sa 09:30-13:30');
  assert.equal(camdenHours('08:30-18:30', ''), 'Mo-Fr 08:30-18:30');
  assert.equal(camdenHours('08:30-18:30', '-'), 'Mo-Fr 08:30-18:30');
  assert.equal(camdenHours('00:00-23:59', '00:00-23:59'), 'Mo-Fr 00:00-24:00; Sa 00:00-24:00');
  assert.equal(camdenHours('', ''), null);
  assert.equal(camdenHours(null, null), null);
  assert.equal(camdenHours('10:00-12:00', null), 'Mo-Fr 10:00-12:00');
  assert.equal(camdenHours(null, '09:30-13:30'), 'Sa 09:30-13:30');
});

test('haringeyHours — 12-hour prose strings → OSM opening_hours', () => {
  assert.deepEqual(haringeyHours('Mon-Fri 12pm-2pm'), { hours: 'Mo-Fr 12:00-14:00', note: null });
  assert.deepEqual(haringeyHours('Mon-Fri 8am-6:30pm'), { hours: 'Mo-Fr 08:00-18:30', note: null });
  assert.deepEqual(haringeyHours('Mon-Fri 10am-12pm'), { hours: 'Mo-Fr 10:00-12:00', note: null });
  assert.deepEqual(haringeyHours('Mon-Fri 10am-12 noon'), { hours: 'Mo-Fr 10:00-12:00', note: null });
  assert.deepEqual(haringeyHours('Mon-Sat 8:30am-6:30pm'), { hours: 'Mo-Sa 08:30-18:30', note: null });
  assert.deepEqual(haringeyHours('Mon-Sun 8am-10pm'), { hours: 'Mo-Su 08:00-22:00', note: null });
  assert.deepEqual(haringeyHours('Mon-Fri 2pm-4pm'), { hours: 'Mo-Fr 14:00-16:00', note: null });
  assert.deepEqual(haringeyHours('Mon-Fri 12:30pm-2:30pm'), { hours: 'Mo-Fr 12:30-14:30', note: null });
});

test('haringeyHours — qualifiers go to the note; event-only zones have null hours', () => {
  assert.deepEqual(haringeyHours('Mon-Sat 8am-6:30pm (non-event); event days vary'), {
    hours: 'Mo-Sa 08:00-18:30',
    note: 'non-event; event days vary',
  });
  assert.deepEqual(haringeyHours('Mon-Fri 10am-12pm (varies by sub-zone)'), {
    hours: 'Mo-Fr 10:00-12:00',
    note: 'varies by sub-zone',
  });
  assert.deepEqual(haringeyHours('Event-only zone'), { hours: null, note: 'Event-only zone' });
  assert.deepEqual(haringeyHours(''), { hours: null, note: null });
  assert.deepEqual(haringeyHours(null), { hours: null, note: null });
});

test('haringeyHours — rejects strings with no usable day/time pattern that still contain digits', () => {
  assert.throws(() => haringeyHours('Mon-Fri 8 to 6')); // no am/pm
  assert.throws(() => haringeyHours('every day 9-5')); // no recognised day token
});
