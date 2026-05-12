// CPZ hours are London wall-clock; opening-hours.ts pins TZ itself, but set it here too
// for clarity / belt-and-braces (opening_hours reads TZ lazily per getState, so this is
// in effect by the time the assertions below run).
process.env.TZ ??= 'Europe/London';

import test from 'node:test';
import assert from 'node:assert/strict';

import { cpzActiveAt, parseOpeningHours } from './opening-hours';

test('cpzActiveAt: a Mo–Fr daytime CPZ is on during a weekday afternoon, off at night, off at the weekend', () => {
  const spec = 'Mo-Fr 10:00-16:00';
  assert.equal(cpzActiveAt(spec, new Date('2026-05-12T13:00:00+01:00')), true); // Tuesday 13:00 BST
  assert.equal(cpzActiveAt(spec, new Date('2026-05-12T21:00:00+01:00')), false); // Tuesday 21:00
  assert.equal(cpzActiveAt(spec, new Date('2026-05-16T13:00:00+01:00')), false); // Saturday 13:00
});

test('cpzActiveAt: a split Mon–Fri + Sat spec handles the Saturday window and leaves Sunday unrestricted', () => {
  const spec = 'Mo-Fr 08:30-18:30; Sa 09:30-13:30';
  assert.equal(cpzActiveAt(spec, new Date('2026-05-16T10:00:00+01:00')), true); // Saturday 10:00
  assert.equal(cpzActiveAt(spec, new Date('2026-05-16T15:00:00+01:00')), false); // Saturday 15:00 (after the window)
  assert.equal(cpzActiveAt(spec, new Date('2026-05-17T10:00:00+01:00')), false); // Sunday 10:00 (no rule)
});

test('cpzActiveAt: an unparseable spec returns null (the caller treats that zone as "hours unknown")', () => {
  assert.equal(cpzActiveAt('banana', new Date()), null);
  assert.equal(parseOpeningHours('banana'), null);
});

test('parseOpeningHours caches: the same spec yields the same parsed object', () => {
  const a = parseOpeningHours('Mo-Fr 09:00-17:00');
  const b = parseOpeningHours('Mo-Fr 09:00-17:00');
  assert.ok(a && b && a === b);
});
