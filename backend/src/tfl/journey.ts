// TfL Journey Planner wrapper (brief §5.3) with the server-side cache from §9.
//
// The brief calls for caching `(zonePoint rounded to 50m, destination rounded to
// 50m, time bucketed to 5min)`. The cache key here adds `includeBus` + `timeIs`
// to that tuple because they materially change the answer. A small in-memory LRU
// is plenty for solo single-user; swap for Redis if this ever runs multi-user.
//
// Always pass coordinates, never stop IDs (Canary Wharf has two stations — §9).

import { config } from '../config';
import { worstTier, type DisruptionTier, type DisruptionLike } from './disruption';

const TFL_BASE = 'https://api.tfl.gov.uk';
const DEFAULT_MODES_NO_BUS = ['tube', 'dlr', 'overground', 'elizabeth-line', 'walking'] as const;
const TFL_TIMEOUT_MS = 12_000;
const CACHE_MAX = 256;          // bounded LRU
const CACHE_TTL_MS = 5 * 60_000; // 5 min — past that, recompute (TfL data freshness)

// --- response shape (just what we use) ----------------------------------------

interface RawTflMode { name?: string }
interface RawTflPoint { commonName?: string; naptanId?: string }
interface RawTflLineIdentifier { id?: string; name?: string }
interface RawTflRouteOption { name?: string; lineIdentifier?: RawTflLineIdentifier }
interface RawTflLeg {
  duration?: number;
  mode?: RawTflMode;
  instruction?: { summary?: string; detailed?: string };
  departurePoint?: RawTflPoint;
  arrivalPoint?: RawTflPoint;
  disruptions?: DisruptionLike[];
  routeOptions?: RawTflRouteOption[];
}
interface RawTflJourney {
  startDateTime?: string;
  arrivalDateTime?: string;
  duration?: number;
  legs?: RawTflLeg[];
}
interface RawTflJourneyResponse {
  journeys?: RawTflJourney[];
  // a few error shapes
  message?: string;
  httpStatusCode?: number;
}

// --- normalized result --------------------------------------------------------

export type LegMode = 'walking' | 'tube' | 'dlr' | 'overground' | 'elizabeth-line' | 'bus' | 'other';

export interface NormalLeg {
  mode: LegMode;
  durationMinutes: number;
  /** 'Northern line to Charing Cross' or 'Walk to …'. */
  summary: string;
  fromName: string | null;
  toName: string | null;
  disruption: DisruptionTier;
  /** Lowercase TfL line id when the leg is transit ('northern', 'elizabeth', 'dlr', …); null for walking legs. */
  lineId: string | null;
  /** Display name for the line ('Northern', 'Elizabeth line'); null for walking legs. */
  lineName: string | null;
}

export interface NormalJourney {
  startDateTime: string | null;
  arrivalDateTime: string | null;
  totalMinutes: number;
  walkToStopMinutes: number;   // duration of the first walking leg (drive-end walk to transit)
  walkFromStopMinutes: number; // duration of the final walking leg (transit to destination)
  transitMinutes: number;      // totalMinutes - walks
  /** Worst disruption tier across all transit legs. 'suspended' = filter the journey. */
  disruption: DisruptionTier;
  legs: NormalLeg[];
}

export class TflMissingKeyError extends Error {
  constructor() {
    super('TFL_APP_KEY is not configured');
    this.name = 'TflMissingKeyError';
  }
}

export class TflFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TflFetchError';
    this.status = status;
  }
}

// --- mini LRU -----------------------------------------------------------------

interface CacheEntry { value: NormalJourney | null; expiresAt: number }
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): NormalJourney | null | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // refresh recency by reinserting (Map iteration order = insertion order)
  cache.delete(key);
  cache.set(key, e);
  return e.value;
}

function cacheSet(key: string, value: NormalJourney | null): void {
  if (cache.size >= CACHE_MAX) {
    // drop oldest
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Round coordinates to a ~50m grid for cache keying (brief §9). */
function snap50m(lat: number, lng: number): string {
  // 0.00045° ≈ 50m at London latitudes.
  return `${(Math.round(lat / 0.00045) * 0.00045).toFixed(5)},${(Math.round(lng / 0.00045) * 0.00045).toFixed(5)}`;
}

/** Round a datetime to a 5-minute bucket (brief §9). Returns the bucket as `YYYYMMDDHHMM` London-local. */
function bucket5min(at: Date): string {
  // TZ is pinned Europe/London in config.ts; `Date` getters read local components.
  const y = at.getFullYear();
  const M = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  const h = String(at.getHours()).padStart(2, '0');
  const m = String(Math.floor(at.getMinutes() / 5) * 5).padStart(2, '0');
  return `${y}${M}${d}${h}${m}`;
}

function fmtDateForTfl(at: Date): { date: string; time: string } {
  // YYYYMMDD / HHMM in London wall-clock — the server's TZ is pinned (config.ts).
  const y = at.getFullYear();
  const M = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  const h = String(at.getHours()).padStart(2, '0');
  const m = String(at.getMinutes()).padStart(2, '0');
  return { date: `${y}${M}${d}`, time: `${h}${m}` };
}

function classifyLegMode(m: string | undefined): LegMode {
  switch (m) {
    case 'walking':
    case 'tube':
    case 'dlr':
    case 'overground':
    case 'elizabeth-line':
    case 'bus':
      return m;
    default:
      return 'other';
  }
}

function normalize(raw: RawTflJourneyResponse): NormalJourney | null {
  const journey = raw.journeys?.[0];
  if (!journey) return null;
  const rawLegs = journey.legs ?? [];
  const legs: NormalLeg[] = rawLegs.map((l) => {
    const mode = classifyLegMode(l.mode?.name);
    const disruption = worstTier(l.disruptions ?? []);
    // routeOptions[0].lineIdentifier carries the line slug/name for transit legs;
    // walking legs have an empty routeOptions entry with no lineIdentifier (just `name: ''`).
    const ro = l.routeOptions?.[0];
    const lineId = ro?.lineIdentifier?.id ?? null;
    const lineName = ro?.lineIdentifier?.name ?? (ro?.name && ro.name.length > 0 ? ro.name : null);
    return {
      mode,
      durationMinutes: typeof l.duration === 'number' ? l.duration : 0,
      summary: l.instruction?.summary ?? '',
      fromName: l.departurePoint?.commonName ?? null,
      toName: l.arrivalPoint?.commonName ?? null,
      disruption,
      lineId,
      lineName,
    };
  });
  // First/last walking-leg minutes; transit = total - both walks.
  const firstWalk = legs[0]?.mode === 'walking' ? legs[0].durationMinutes : 0;
  const lastWalk = legs.length > 0 && legs[legs.length - 1]!.mode === 'walking' ? legs[legs.length - 1]!.durationMinutes : 0;
  const total = typeof journey.duration === 'number' ? journey.duration : legs.reduce((s, l) => s + l.durationMinutes, 0);
  const transit = Math.max(0, total - firstWalk - lastWalk);
  const transitLegs = legs.filter((l) => l.mode !== 'walking');
  const disruption = transitLegs.length > 0 ? (transitLegs.reduce<DisruptionTier>((worst, l) => (rank(l.disruption) > rank(worst) ? l.disruption : worst), 'none')) : 'none';
  return {
    startDateTime: journey.startDateTime ?? null,
    arrivalDateTime: journey.arrivalDateTime ?? null,
    totalMinutes: total,
    walkToStopMinutes: firstWalk,
    walkFromStopMinutes: lastWalk,
    transitMinutes: transit,
    disruption,
    legs,
  };
}

function rank(t: DisruptionTier): number {
  return t === 'suspended' ? 3 : t === 'severe' ? 2 : t === 'minor' ? 1 : 0;
}

// --- public api ---------------------------------------------------------------

export interface JourneyRequest {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** "Leave now" ⇒ Departing + the current time. "Arrive by X" ⇒ Arriving + X. */
  timeIs: 'Departing' | 'Arriving';
  at: Date;
  includeBus: boolean;
}

export async function fetchJourney(req: JourneyRequest): Promise<NormalJourney | null> {
  if (!config.tflAppKey) throw new TflMissingKeyError();

  const key = [
    snap50m(req.from.lat, req.from.lng),
    snap50m(req.to.lat, req.to.lng),
    bucket5min(req.at),
    req.timeIs,
    req.includeBus ? 'bus' : 'nobus',
  ].join('|');

  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const modes = req.includeBus ? [...DEFAULT_MODES_NO_BUS, 'bus'] : [...DEFAULT_MODES_NO_BUS];
  const { date, time } = fmtDateForTfl(req.at);

  const url = new URL(
    `${TFL_BASE}/Journey/JourneyResults/${req.from.lat},${req.from.lng}/to/${req.to.lat},${req.to.lng}`,
  );
  url.searchParams.set('mode', modes.join(','));
  url.searchParams.set('timeIs', req.timeIs);
  url.searchParams.set('date', date);
  url.searchParams.set('time', time);
  url.searchParams.set('walkingSpeed', 'average');
  url.searchParams.set('app_key', config.tflAppKey);

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TFL_TIMEOUT_MS);
  let body: RawTflJourneyResponse;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) {
      // TfL routinely returns 300 ("multiple stations") / 404 ("no journey found") on edge cases.
      // Treat any non-200 as "no journey" (cache the null), with status surfaced on the error path.
      if (res.status === 404 || res.status === 300) {
        cacheSet(key, null);
        return null;
      }
      throw new TflFetchError(`TfL Journey ${res.status} ${res.statusText}`, res.status);
    }
    body = (await res.json()) as RawTflJourneyResponse;
  } finally {
    clearTimeout(to);
  }
  const normal = normalize(body);
  cacheSet(key, normal);
  return normal;
}

/** Run a bounded number of journey fetches in parallel and collect (value, error) for each input. */
export async function fetchJourneysParallel<T>(
  inputs: T[],
  toRequest: (t: T) => JourneyRequest,
  concurrency: number,
): Promise<Array<{ input: T; journey: NormalJourney | null; error: Error | null }>> {
  const results: Array<{ input: T; journey: NormalJourney | null; error: Error | null }> = new Array(inputs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= inputs.length) return;
      try {
        const journey = await fetchJourney(toRequest(inputs[i]!));
        results[i] = { input: inputs[i]!, journey, error: null };
      } catch (err) {
        results[i] = { input: inputs[i]!, journey: null, error: err as Error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// --- exported for tests -------------------------------------------------------

export const _internals = { snap50m, bucket5min, normalize };
