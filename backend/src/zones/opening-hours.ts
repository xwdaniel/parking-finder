// Thin wrapper around the `opening_hours.js` library — used to decide whether a CPZ
// is operational at the user's intended arrival time (brief §6.2).
//
// `opening_hours.getState()` reads local-time `Date` getters, so the process must run
// on Europe/London for these London CPZ specs to be evaluated correctly. config.ts pins
// `TZ` for the server; we pin it here too (idempotently — an explicit `TZ` still wins)
// so a caller that hasn't gone through config (tests, ad-hoc scripts) still gets London
// wall-clock semantics. `opening_hours` reads `TZ` lazily per `getState`, not at import,
// so this assignment is in effect by the time `cpzActiveAt` is ever called.
process.env.TZ ??= 'Europe/London';

import OpeningHours from 'opening_hours';

// Parsed-spec cache: the same handful of `opening_hours` strings recur across the
// thousands of zones evaluated per `/zones` request.
const cache = new Map<string, OpeningHours | null>();

/** Parse an OSM `opening_hours` spec. Returns null (and caches that) if it doesn't parse. */
export function parseOpeningHours(spec: string): OpeningHours | null {
  const hit = cache.get(spec);
  if (hit !== undefined) return hit;
  let parsed: OpeningHours | null;
  try {
    parsed = new OpeningHours(spec);
  } catch {
    parsed = null;
  }
  cache.set(spec, parsed);
  return parsed;
}

/**
 * Is a CPZ with this `opening_hours` spec *operational* (parking restricted) at `at`?
 *   true  — restricted then  → the street is excluded at that time
 *   false — off then         → this CPZ doesn't apply (the street may still be eligible)
 *   null  — spec didn't parse → caller treats the zone as "in a CPZ, hours unknown" (confidence 0.6)
 * `at` is interpreted in the process timezone (Europe/London — see the note above).
 */
export function cpzActiveAt(spec: string, at: Date): boolean | null {
  const oh = parseOpeningHours(spec);
  if (!oh) return null;
  try {
    return oh.getState(at);
  } catch {
    return null;
  }
}
