import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTimeRanges, camdenHours } from './hours';

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
