import { readFileSync, writeFileSync } from 'node:fs';

const POSITIVE_LANE_VALUES = new Set([
  'parallel', 'diagonal', 'perpendicular',
  'on_street', 'half_on_kerb', 'on_kerb', 'painted_area_only',
  'lane', 'street_side',
]);
const POSITIVE_CONDITION_VALUES = new Set(['free', 'no_charge', 'yes']);
const RESTRICTIVE_CONDITION_VALUES = new Set([
  'permit', 'residents', 'disc', 'ticket', 'customers',
  'no_parking', 'no_stopping', 'private',
]);

const POSITIVE_LANE_KEYS = new Set([
  'parking:lane:left', 'parking:lane:right', 'parking:lane:both',
  'parking:left', 'parking:right', 'parking:both',
]);
const CONDITION_KEY_RE = /^parking:condition:(left|right|both)$/;
const ANY_PARKING_KEY_RE = /^parking:/;

function classify(tags) {
  let hasAnyParking = false;
  let hasPositiveLane = false;
  let hasPositiveCondition = false;
  let hasRestrictiveCondition = false;
  let timeIntervalPresent = false;

  for (const [k, v] of Object.entries(tags)) {
    if (ANY_PARKING_KEY_RE.test(k)) hasAnyParking = true;
    if (POSITIVE_LANE_KEYS.has(k) && POSITIVE_LANE_VALUES.has(v)) {
      hasPositiveLane = true;
    }
    if (CONDITION_KEY_RE.test(k)) {
      if (POSITIVE_CONDITION_VALUES.has(v)) hasPositiveCondition = true;
      if (RESTRICTIVE_CONDITION_VALUES.has(v)) hasRestrictiveCondition = true;
    }
    if (k.includes('time_interval') || k.includes(':maxstay')) {
      timeIntervalPresent = true;
    }
  }

  return {
    hasAnyParking,
    hasPositiveLane,
    hasPositiveCondition,
    hasRestrictiveCondition,
    timeIntervalPresent,
  };
}

function summarise(name, path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const ways = data.elements;
  const total = ways.length;

  let any = 0, posLane = 0, posCondition = 0, restrictive = 0, timeBased = 0;
  let positiveOnly = 0;
  let restrictiveOnly = 0;
  let mixed = 0;

  for (const w of ways) {
    const c = classify(w.tags ?? {});
    if (c.hasAnyParking) any++;
    if (c.hasPositiveLane) posLane++;
    if (c.hasPositiveCondition) posCondition++;
    if (c.hasRestrictiveCondition) restrictive++;
    if (c.timeIntervalPresent) timeBased++;

    const hasPositive = c.hasPositiveLane || c.hasPositiveCondition;
    if (hasPositive && !c.hasRestrictiveCondition) positiveOnly++;
    if (c.hasRestrictiveCondition && !hasPositive) restrictiveOnly++;
    if (hasPositive && c.hasRestrictiveCondition) mixed++;
  }

  const pct = (n) => ((n / total) * 100).toFixed(1) + '%';

  return {
    name,
    total,
    any, anyPct: pct(any),
    posLane, posLanePct: pct(posLane),
    posCondition, posConditionPct: pct(posCondition),
    restrictive, restrictivePct: pct(restrictive),
    timeBased, timeBasedPct: pct(timeBased),
    positiveOnly, positiveOnlyPct: pct(positiveOnly),
    restrictiveOnly, restrictiveOnlyPct: pct(restrictiveOnly),
    mixed, mixedPct: pct(mixed),
    untagged: total - any,
    untaggedPct: pct(total - any),
  };
}

function normaliseName(s) {
  return (s ?? '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
function findStreet(path, queryName) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const target = normaliseName(queryName);
  const matches = data.elements.filter((w) => normaliseName(w.tags?.name) === target);
  return matches;
}

const camden = summarise('Camden', '/Users/dxwz/Projects/parking-finder/osm_spike/camden_residential.json');
const waltham = summarise('Waltham Forest', '/Users/dxwz/Projects/parking-finder/osm_spike/waltham_forest_residential.json');

const KNOWN_STREETS = [
  { name: 'Fyfield Road', borough: 'Waltham Forest', file: 'waltham_forest_residential.json' },
  { name: 'Winsbeach', borough: 'Waltham Forest', file: 'waltham_forest_residential.json' },
  { name: "St Augustine's Road", borough: 'Camden', file: 'camden_residential.json' },
  { name: 'Cantelowes Road', borough: 'Camden', file: 'camden_residential.json' },
  { name: 'Rousden Street', borough: 'Camden', file: 'camden_residential.json' },
];

const streetResults = KNOWN_STREETS.map((s) => {
  const matches = findStreet(`/Users/dxwz/Projects/parking-finder/osm_spike/${s.file}`, s.name);
  const segments = matches.map((m) => {
    const t = m.tags ?? {};
    const parkingTags = Object.fromEntries(
      Object.entries(t).filter(([k]) => k.startsWith('parking:'))
    );
    const c = classify(t);
    return { wayId: m.id, parkingTags, classify: c };
  });
  return { ...s, found: matches.length, segments };
});

const out = { boroughs: [camden, waltham], streets: streetResults };
writeFileSync('/Users/dxwz/Projects/parking-finder/osm_spike/analysis.json', JSON.stringify(out, null, 2));

console.log('=== BOROUGH COVERAGE ===\n');
for (const b of [camden, waltham]) {
  console.log(`${b.name}:`);
  console.log(`  total residential ways: ${b.total}`);
  console.log(`  any parking:* tag:      ${b.any} (${b.anyPct})`);
  console.log(`  positive lane geometry: ${b.posLane} (${b.posLanePct})`);
  console.log(`  positive condition:     ${b.posCondition} (${b.posConditionPct})`);
  console.log(`  restrictive condition:  ${b.restrictive} (${b.restrictivePct})`);
  console.log(`  time-based:             ${b.timeBased} (${b.timeBasedPct})`);
  console.log(`  ELIGIBLE (positive, no restriction): ${b.positiveOnly} (${b.positiveOnlyPct})`);
  console.log(`  excluded (restrictive only):         ${b.restrictiveOnly} (${b.restrictiveOnlyPct})`);
  console.log(`  mixed (positive + restriction):      ${b.mixed} (${b.mixedPct})`);
  console.log(`  untagged:               ${b.untagged} (${b.untaggedPct})`);
  console.log();
}

console.log('=== KNOWN-FREE STREET CROSS-CHECK ===\n');
for (const r of streetResults) {
  console.log(`${r.name} (${r.borough}) — ${r.found} segment(s) found`);
  if (r.found === 0) {
    console.log('  NOT FOUND in OSM residential ways for this borough');
  } else {
    for (const seg of r.segments) {
      const tags = Object.entries(seg.parkingTags);
      console.log(`  way ${seg.wayId}:`);
      if (tags.length === 0) {
        console.log('    no parking tags at all');
      } else {
        for (const [k, v] of tags) console.log(`    ${k} = ${v}`);
      }
      const c = seg.classify;
      const elig = (c.hasPositiveLane || c.hasPositiveCondition) && !c.hasRestrictiveCondition;
      console.log(`    -> brief eligibility: ${elig ? 'ELIGIBLE' : 'NOT eligible'}`);
    }
  }
  console.log();
}
