// Helpers for turning council "operational hours" strings into OSM `opening_hours`
// time syntax (the dialect `opening_hours.js` parses, used at query time in §6.2).
//
// CPZ `hours` semantics in this codebase: the value of `cpz.hours` is the *restricted*
// window. A street in that CPZ is free at time T iff `opening_hours.js` says the rule
// is NOT open at T. So we only ever encode the days/times the controls apply.

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** "9:00" → "09:00"; "23:59" → "24:00" (council shorthand for "end of day"). */
function normaliseTime(raw: string): string {
  const m = raw.trim().match(TIME_RE);
  if (!m) throw new Error(`unparseable time: "${raw}"`);
  const hh = m[1];
  const mm = m[2];
  if (hh === undefined || mm === undefined) throw new Error(`unparseable time: "${raw}"`);
  if (hh === '23' && mm === '59') return '24:00';
  if (hh === '24' && mm === '00') return '24:00';
  const h = Number(hh);
  if (h > 24 || Number(mm) > 59) throw new Error(`time out of range: "${raw}"`);
  return `${hh.padStart(2, '0')}:${mm}`;
}

/**
 * Parse a time-of-day spec into OSM `opening_hours` time syntax, or null for "no control".
 * Handles a single range ("09:00-18:30"), split ranges joined by "&" or ","
 * ("08:00-09:00 & 15:00-17:00" → "08:00-09:00,15:00-17:00"), stray spaces, and
 * the empty markers "", "-", "n/a", "na", "none".
 */
export function parseTimeRanges(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (s === '' || s === '-' || s === 'n/a' || s === 'na' || s === 'none') return null;

  const chunks = s.split(/\s*[&,]\s*/).filter((c) => c.length > 0);
  if (chunks.length === 0) return null;

  const ranges = chunks.map((chunk) => {
    const m = chunk.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m) throw new Error(`unparseable time range: "${chunk}" (from "${raw}")`);
    const start = m[1];
    const end = m[2];
    if (start === undefined || end === undefined) throw new Error(`unparseable time range: "${chunk}"`);
    return `${normaliseTime(start)}-${normaliseTime(end)}`;
  });
  return ranges.join(',');
}

/**
 * Camden's CPZ polygon dataset (vf6e-iymu) carries two control fields — Monday–Friday
 * and Saturday — and has no Sunday field (Sunday is structurally unrestricted). Combine
 * them into `opening_hours` syntax, e.g.
 *   ("09:00-18:30", "09:30-13:30") → "Mo-Fr 09:00-18:30; Sa 09:30-13:30"
 *   ("08:30-18:30", "")            → "Mo-Fr 08:30-18:30"
 *   ("00:00-23:59", "00:00-23:59") → "Mo-Fr 00:00-24:00; Sa 00:00-24:00"
 * Returns null when neither field carries a control.
 */
export function camdenHours(
  mondayToFriday: string | null | undefined,
  saturday: string | null | undefined,
): string | null {
  const mf = parseTimeRanges(mondayToFriday);
  const sa = parseTimeRanges(saturday);
  const parts: string[] = [];
  if (mf) parts.push(`Mo-Fr ${mf}`);
  if (sa) parts.push(`Sa ${sa}`);
  return parts.length > 0 ? parts.join('; ') : null;
}
