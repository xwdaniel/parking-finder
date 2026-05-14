import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyDisruption, scoreMultiplier, worstTier } from './disruption';

test("classifyDisruption: 'Suspended' → suspended", () => {
  assert.equal(classifyDisruption({ category: 'RealTime', description: 'Northern line: Service suspended between …' }), 'suspended');
});

test("classifyDisruption: 'Part Closure' → suspended (matches the filter rule for affecting-your-stop)", () => {
  assert.equal(classifyDisruption({ categoryDescription: 'Part Closure', description: 'No service between Kennington and Camden Town' }), 'suspended');
});

test("classifyDisruption: 'Severe delays' → severe", () => {
  assert.equal(classifyDisruption({ category: 'RealTime', description: 'Severe delays due to a signal failure at Oxford Circus.' }), 'severe');
});

test("classifyDisruption: 'Minor delays' → minor", () => {
  assert.equal(classifyDisruption({ category: 'RealTime', description: 'Minor delays due to a customer incident.' }), 'minor');
});

test("classifyDisruption: 'PlannedWork' → minor", () => {
  assert.equal(classifyDisruption({ category: 'PlannedWork', description: 'Planned work this weekend.' }), 'minor');
});

test("classifyDisruption: unrecognised category → none (be conservative on unknown phrasing — D12)", () => {
  assert.equal(classifyDisruption({ category: 'Information', description: 'Lift unavailable at one entrance.' }), 'none');
  assert.equal(classifyDisruption({}), 'none');
});

test("classifyDisruption: 'No service between A and B' is suspended, but 'no service alerts' is not (the regex is anchored)", () => {
  assert.equal(classifyDisruption({ description: 'No service between Kennington and Camden Town.' }), 'suspended');
  assert.equal(classifyDisruption({ description: 'no service alerts at the moment.' }), 'none');
});

test('worstTier picks the highest-rank tier across a list', () => {
  assert.equal(
    worstTier([
      { description: 'Minor delays' },
      { description: 'Severe delays' },
      { description: 'PlannedWork' },
    ]),
    'severe',
  );
  assert.equal(
    worstTier([{ description: 'Suspended between A and B' }, { description: 'Minor delays' }]),
    'suspended',
  );
  assert.equal(worstTier([]), 'none');
});

test('scoreMultiplier: severe → 0.7, anything else → 1 (suspended is filtered earlier, never scored)', () => {
  assert.equal(scoreMultiplier('severe'), 0.7);
  assert.equal(scoreMultiplier('minor'), 1);
  assert.equal(scoreMultiplier('none'), 1);
});
