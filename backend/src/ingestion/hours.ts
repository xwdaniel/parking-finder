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

// --- Haringey (and similar councils that publish 12-hour, prose-style hours) -----

const DAY_NAMES: Record<string, string> = {
  mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su',
};

/** "8am" → "08:00"; "6:30pm" → "18:30"; "12pm"/"12 noon" → "12:00"; "12am"/"midnight" → "00:00". */
function to24h(hour: number, minute: number, meridiem: string): string {
  if (minute < 0 || minute > 59 || hour < 1 || hour > 12) {
    throw new Error(`time out of range: ${hour}:${minute} ${meridiem}`);
  }
  let h: number;
  switch (meridiem) {
    case 'noon': h = 12; break;
    case 'midnight': h = 0; break;
    case 'am': h = hour === 12 ? 0 : hour; break;
    case 'pm': h = hour === 12 ? 12 : hour + 12; break;
    default: throw new Error(`missing/unknown meridiem: "${meridiem}"`);
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface HaringeyHours {
  /** OSM opening_hours syntax for the restricted window, or null if uncatalogued / event-only. */
  hours: string | null;
  /** Parenthetical / trailing qualifier from the council string, e.g. "non-event; event days vary". */
  note: string | null;
}

/**
 * Parse a Haringey-style council hours string (e.g. "Mon-Fri 8am-6:30pm",
 * "Mon-Sat 8am-6:30pm (non-event); event days vary", "Event-only zone").
 * Returns `{ hours, note }`; `hours` is null when the string carries no usable
 * day/time window (event-only zones, etc.).
 */
export function haringeyHours(raw: string | null | undefined): HaringeyHours {
  if (raw == null) return { hours: null, note: null };
  const original = raw.trim();
  if (original === '') return { hours: null, note: null };

  // Pull off a parenthetical and/or everything after the first ';' as the note.
  const noteParts: string[] = [];
  let core = original;
  const paren = core.match(/\(([^)]*)\)/);
  if (paren) {
    if (paren[1]) noteParts.push(paren[1].trim());
    core = (core.slice(0, paren.index) + core.slice((paren.index ?? 0) + paren[0].length)).trim();
  }
  const semi = core.indexOf(';');
  if (semi !== -1) {
    const after = core.slice(semi + 1).trim();
    if (after) noteParts.push(after);
    core = core.slice(0, semi).trim();
  }
  core = core.replace(/\s+/g, ' ').trim();
  const note = noteParts.length > 0 ? noteParts.join('; ') : null;

  // Event-only / no time window.
  if (/event[- ]only/i.test(original) || !/\d/.test(core)) {
    return { hours: null, note: note ?? original };
  }

  const dayMatch = core.match(
    /^(mon|tue|wed|thu|fri|sat|sun)(?:\s*[-–]\s*(mon|tue|wed|thu|fri|sat|sun))?\s+(.+)$/i,
  );
  if (!dayMatch) throw new Error(`unparseable Haringey hours: "${raw}"`);
  const startDay = DAY_NAMES[dayMatch[1]!.toLowerCase()];
  const endDayRaw = dayMatch[2];
  const endDay = endDayRaw ? DAY_NAMES[endDayRaw.toLowerCase()] : undefined;
  const timePart = dayMatch[3]!;
  if (!startDay || (endDayRaw && !endDay)) throw new Error(`unparseable day range: "${raw}"`);
  const days = endDay ? `${startDay}-${endDay}` : startDay;

  const t = timePart.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon|midnight)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon|midnight)?$/i,
  );
  if (!t) throw new Error(`unparseable time window: "${timePart}" (from "${raw}")`);
  const startMer = (t[3] ?? '').toLowerCase();
  const endMer = (t[6] ?? '').toLowerCase();
  // "12 noon" sometimes written without am/pm; otherwise both ends must carry a meridiem.
  if (!startMer || !endMer) throw new Error(`ambiguous 12-hour time (missing am/pm): "${raw}"`);
  const start = to24h(Number(t[1]), Number(t[2] ?? '0'), startMer);
  const end = to24h(Number(t[4]), Number(t[5] ?? '0'), endMer);

  return { hours: `${days} ${start}-${end}`, note };
}
