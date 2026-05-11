import { readFileSync, writeFileSync } from 'node:fs';

// Step 0b classifier. Same spirit as analyze.mjs, plus an explicit
// "CPZ zone tag" signal (the thing WF scored 62.6% on) and zone-code collection.

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
const ANY_PARKING_KEY_RE = /^parking:/;
const ZONE_KEY_RE = /^parking:.*zone$/;          // parking:both:zone, parking:left:zone, parking:condition:both:zone, ...
const CONDITION_KEY_RE = /^parking:condition:(left|right|both)$/;
const POSITIVE_LANE_KEYS = new Set([
  'parking:lane:left', 'parking:lane:right', 'parking:lane:both',
  'parking:left', 'parking:right', 'parking:both',
]);

function classify(tags) {
  let hasAnyParking = false, hasPositiveLane = false, hasPositiveCondition = false;
  let hasRestrictiveCondition = false, hasZoneTag = false, timeIntervalPresent = false;
  const zoneCodes = new Set();

  for (const [k, v] of Object.entries(tags)) {
    if (ANY_PARKING_KEY_RE.test(k)) hasAnyParking = true;
    if (ZONE_KEY_RE.test(k)) { hasZoneTag = true; for (const z of String(v).split(';')) zoneCodes.add(z.trim()); }
    if (POSITIVE_LANE_KEYS.has(k) && POSITIVE_LANE_VALUES.has(v)) hasPositiveLane = true;
    if (CONDITION_KEY_RE.test(k)) {
      if (POSITIVE_CONDITION_VALUES.has(v)) hasPositiveCondition = true;
      if (RESTRICTIVE_CONDITION_VALUES.has(v)) hasRestrictiveCondition = true;
    }
    if (k.includes('time_interval') || k.includes(':maxstay')) timeIntervalPresent = true;
  }
  return { hasAnyParking, hasPositiveLane, hasPositiveCondition, hasRestrictiveCondition, hasZoneTag, timeIntervalPresent, zoneCodes };
}

function summarise(name, path) {
  const ways = JSON.parse(readFileSync(path, 'utf8')).elements;
  const total = ways.length;
  let any = 0, zone = 0, posLane = 0, posCond = 0, restr = 0, timeBased = 0;
  const allZoneCodes = new Map(); // code -> count of ways
  for (const w of ways) {
    const c = classify(w.tags ?? {});
    if (c.hasAnyParking) any++;
    if (c.hasZoneTag) { zone++; for (const z of c.zoneCodes) allZoneCodes.set(z, (allZoneCodes.get(z) ?? 0) + 1); }
    if (c.hasPositiveLane) posLane++;
    if (c.hasPositiveCondition) posCond++;
    if (c.hasRestrictiveCondition) restr++;
    if (c.timeIntervalPresent) timeBased++;
  }
  const pct = (n) => ((n / total) * 100).toFixed(1) + '%';
  const zoneCodesSorted = [...allZoneCodes.entries()].sort((a, b) => b[1] - a[1]);
  return {
    name, total,
    any, anyPct: pct(any),
    zone, zonePct: pct(zone),
    posLane, posLanePct: pct(posLane),
    posCond, posCondPct: pct(posCond),
    restr, restrPct: pct(restr),
    timeBased, timeBasedPct: pct(timeBased),
    distinctZoneCodes: zoneCodesSorted.length,
    zoneCodes: zoneCodesSorted,
  };
}

function normaliseName(s) {
  return (s ?? '').toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
}
function findStreet(path, queryName) {
  const ways = JSON.parse(readFileSync(path, 'utf8')).elements;
  const target = normaliseName(queryName);
  return ways.filter((w) => normaliseName(w.tags?.name) === target);
}

const BOROUGHS = [
  ['Haringey', 'haringey_residential.json'],
  ['Tower Hamlets', 'tower_hamlets_residential.json'],
  ['Islington', 'islington_residential.json'],
  ['Hackney', 'hackney_residential.json'],
  ['Newham', 'newham_residential.json'],
];
const dir = '/Users/dxwz/Projects/parking-finder/osm_spike/';
const summaries = BOROUGHS.map(([n, f]) => summarise(n, dir + f));

const KNOWN_STREETS = [
  { name: 'Antill Road', borough: 'Haringey', file: 'haringey_residential.json' },       // N15
  { name: 'Sclater Street', borough: 'Tower Hamlets', file: 'tower_hamlets_residential.json' }, // E1
];
const streetResults = KNOWN_STREETS.map((s) => {
  const matches = findStreet(dir + s.file, s.name);
  return {
    ...s,
    found: matches.length,
    segments: matches.map((m) => {
      const t = m.tags ?? {};
      const parkingTags = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('parking:')));
      return { wayId: m.id, postcode: t['addr:postcode'], parkingTags, allTagsSample: { name: t.name, ...parkingTags }, classify: { ...classify(t), zoneCodes: [...classify(t).zoneCodes] } };
    }),
  };
});

writeFileSync(dir + 'recon_analysis.json', JSON.stringify({ boroughs: summaries.map(s => ({ ...s, zoneCodes: s.zoneCodes })), streets: streetResults }, null, 2));

console.log('=== STEP 0b — BOROUGH OSM COVERAGE ===');
console.log('(baselines from Step 0: Camden any=2.3% zone≈0% ; Waltham Forest any=62.6% zone≈high)\n');
for (const b of summaries) {
  console.log(`${b.name}:  ${b.total} residential ways`);
  console.log(`  any parking:* tag         ${b.any} (${b.anyPct})`);
  console.log(`  CPZ zone tag (parking:*:zone)  ${b.zone} (${b.zonePct})   <- the WF-style join signal`);
  console.log(`  distinct zone codes       ${b.distinctZoneCodes}`);
  console.log(`  positive lane geometry    ${b.posLane} (${b.posLanePct})`);
  console.log(`  positive condition        ${b.posCond} (${b.posCondPct})`);
  console.log(`  restrictive condition     ${b.restr} (${b.restrPct})`);
  console.log(`  time-based tag            ${b.timeBased} (${b.timeBasedPct})`);
  if (b.zoneCodes.length) {
    console.log(`  top zone codes: ${b.zoneCodes.slice(0, 12).map(([z, n]) => `${z}(${n})`).join(', ')}`);
  }
  console.log();
}

console.log('=== KNOWN-FREE STREET CROSS-CHECK ===\n');
for (const r of streetResults) {
  console.log(`${r.name} (${r.borough}) — ${r.found} segment(s)`);
  if (!r.found) { console.log('  NOT FOUND as a highway=residential way with that name\n'); continue; }
  for (const seg of r.segments) {
    console.log(`  way ${seg.wayId}${seg.postcode ? ` [${seg.postcode}]` : ''}:`);
    const tags = Object.entries(seg.parkingTags);
    if (!tags.length) console.log('    (no parking:* tags)');
    for (const [k, v] of tags) console.log(`    ${k} = ${v}`);
    const c = seg.classify;
    console.log(`    zone codes: ${c.zoneCodes.length ? c.zoneCodes.join(', ') : '(none)'}`);
  }
  console.log();
}
