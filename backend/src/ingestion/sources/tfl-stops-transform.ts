// Pure transform from TfL StopPoint rows → tfl_stop records. No HTTP, no DB —
// keeps the brittle bit (TfL's StopPoint shape) trivially unit-testable.
//
// We keep only stations served by a mode the brief actually routes on (§5.3:
// tube, dlr, overground, elizabeth-line). National-rail rows on Naptan*Station
// pages get filtered out — TfL Journey will still pick up rail legs at query
// time via lat/lng. The mode set we *store* is the intersection between the
// station's published modes and our routed-modes whitelist; anything else
// (national-rail, bus, tram, cable-car) is dropped so the DB stays a clean
// "where can our transit search anchor" snapshot.

export interface TflStopRecord {
  id: string;            // naptanId / id — '940GZZLUCND'
  name: string;          // 'Camden Town Underground Station'
  modes: string[];       // filtered subset of ROUTED_MODES
  lat: number;
  lng: number;
}

export interface RawTflStopPoint {
  id?: string;
  naptanId?: string;
  commonName?: string;
  stopType?: string;
  modes?: string[];
  lat?: number;
  lon?: number;
}

export const ROUTED_MODES = ['tube', 'dlr', 'overground', 'elizabeth-line'] as const;
type RoutedMode = (typeof ROUTED_MODES)[number];

function isRoutedMode(m: string): m is RoutedMode {
  return (ROUTED_MODES as readonly string[]).includes(m);
}

/** Project a raw TfL StopPoint row into a TflStopRecord, or null if it isn't a routed station. */
export function projectStopPoint(raw: RawTflStopPoint): TflStopRecord | null {
  const id = raw.id ?? raw.naptanId;
  const name = raw.commonName;
  const lat = raw.lat;
  const lng = raw.lon;
  if (!id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null;

  const allModes = raw.modes ?? [];
  const modes = allModes.filter(isRoutedMode);
  if (modes.length === 0) return null; // not a station we'd route on

  return { id, name, modes, lat, lng };
}

/** Project a batch of raw rows, drop duplicates by id (TfL sometimes re-lists across pages). */
export function projectStopPoints(rows: RawTflStopPoint[]): TflStopRecord[] {
  const out = new Map<string, TflStopRecord>();
  for (const r of rows) {
    const rec = projectStopPoint(r);
    if (rec && !out.has(rec.id)) out.set(rec.id, rec);
  }
  return [...out.values()];
}
