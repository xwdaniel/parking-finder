import { getDb } from './db';
import type { LoggedCandidate, OutcomeKind, OutcomeRow, SearchRow } from './types';
import type { SearchParams } from '../../navigation/types';

// Personal-log I/O (brief §7). All functions are async — never call from render;
// fire from effects, button handlers, or react-query mutations.

// ---------- search rows ---------------------------------------------------------

export interface RecordSearchInput {
  search: SearchParams;
  /** Top-N ranked candidates we showed the user (we store small projections, not the full GeoJSON). */
  results: LoggedCandidate[];
}

/** Insert one row into `search`. Returns the new row id, to be passed to `recordPick` later. */
export async function recordSearch({ search, results }: RecordSearchInput): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO search (
       searched_at, destination_lat, destination_lng, destination_label,
       mode, time_mode, arrival_time, max_walk_minutes, include_bus,
       picked_zone_id, raw_results_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    new Date().toISOString(),
    search.destinationLat,
    search.destinationLng,
    search.destinationLabel,
    search.mode,
    search.timeMode,
    search.arrivalTime ?? null,
    search.maxWalkMinutes,
    search.includeBus ? 1 : 0,
    JSON.stringify(results),
  );
  return r.lastInsertRowId;
}

/** Set the chosen zone on an existing search row — fired the moment the user taps Navigate. */
export async function recordPick(searchId: number, zoneId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE search SET picked_zone_id = ? WHERE id = ?`, zoneId, searchId);
}

export async function listSearches(limit = 50): Promise<SearchRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    searched_at: string;
    destination_lat: number | null;
    destination_lng: number | null;
    destination_label: string | null;
    mode: string;
    time_mode: string;
    arrival_time: string | null;
    max_walk_minutes: number | null;
    include_bus: number | null;
    picked_zone_id: string | null;
    raw_results_json: string | null;
  }>(`SELECT * FROM search ORDER BY searched_at DESC LIMIT ?`, limit);
  return rows.map(rowToSearch);
}

function rowToSearch(r: {
  id: number;
  searched_at: string;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_label: string | null;
  mode: string;
  time_mode: string;
  arrival_time: string | null;
  max_walk_minutes: number | null;
  include_bus: number | null;
  picked_zone_id: string | null;
  raw_results_json: string | null;
}): SearchRow {
  return {
    id: r.id,
    searchedAt: r.searched_at,
    destinationLat: r.destination_lat,
    destinationLng: r.destination_lng,
    destinationLabel: r.destination_label,
    mode: r.mode as SearchRow['mode'],
    timeMode: r.time_mode as SearchRow['timeMode'],
    arrivalTime: r.arrival_time,
    maxWalkMinutes: r.max_walk_minutes,
    includeBus: r.include_bus === null ? null : r.include_bus ? 1 : 0,
    pickedZoneId: r.picked_zone_id,
    rawResultsJson: r.raw_results_json,
  };
}

// ---------- outcome rows --------------------------------------------------------

export interface RecordOutcomeInput {
  zoneId: string;
  outcome: OutcomeKind;
  /** Required when outcome === 'verified_hours'; ignored otherwise. OSM `opening_hours` syntax. */
  hoursObserved?: string | null;
  notes?: string | null;
}

/** Upsert into `outcome`. Increments parked_count / ticket_count when appropriate. */
export async function recordOutcome({ zoneId, outcome, hoursObserved, notes }: RecordOutcomeInput): Promise<void> {
  const now = new Date().toISOString();
  const parkedInc = outcome === 'parked_ok' ? 1 : 0;
  const ticketInc = outcome === 'ticketed' ? 1 : 0;
  const hours = outcome === 'verified_hours' ? hoursObserved ?? null : null;
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO outcome (zone_id, parked_count, ticket_count, last_outcome, last_outcome_at, hours_observed, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(zone_id) DO UPDATE SET
       parked_count = outcome.parked_count + excluded.parked_count,
       ticket_count = outcome.ticket_count + excluded.ticket_count,
       last_outcome = excluded.last_outcome,
       last_outcome_at = excluded.last_outcome_at,
       hours_observed = COALESCE(excluded.hours_observed, outcome.hours_observed),
       notes = COALESCE(excluded.notes, outcome.notes)`,
    zoneId,
    parkedInc,
    ticketInc,
    outcome,
    now,
    hours,
    notes ?? null,
  );
}

/** Returns every outcome row, indexed by zone_id — feeds the displayConfidence override (D31). */
export async function listOutcomes(): Promise<Map<string, OutcomeRow>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    zone_id: string;
    parked_count: number;
    ticket_count: number;
    last_outcome: string | null;
    last_outcome_at: string | null;
    hours_observed: string | null;
    notes: string | null;
  }>(`SELECT * FROM outcome`);
  const out = new Map<string, OutcomeRow>();
  for (const r of rows) {
    out.set(r.zone_id, {
      zoneId: r.zone_id,
      parkedCount: r.parked_count,
      ticketCount: r.ticket_count,
      lastOutcome: (r.last_outcome ?? null) as OutcomeRow['lastOutcome'],
      lastOutcomeAt: r.last_outcome_at,
      hoursObserved: r.hours_observed,
      notes: r.notes,
    });
  }
  return out;
}

// ---------- pending-pick lookup (drives the post-park prompt) -------------------

export interface PendingPick {
  searchId: number;
  zoneId: string;
  pickedAtIso: string; // we surface the search's `searched_at` as a proxy — close enough for UX timing
  destinationLabel: string | null;
}

/**
 * Most-recent search that has a `picked_zone_id` but no matching `outcome` row.
 * Bounded by `maxAgeMs` so we don't surface a prompt for a drive 3 days ago.
 */
export async function getPendingPick(maxAgeMs = 6 * 60 * 60 * 1000): Promise<PendingPick | null> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const db = await getDb();
  const row = await db.getFirstAsync<{
    id: number;
    searched_at: string;
    picked_zone_id: string;
    destination_label: string | null;
  }>(
    `SELECT s.id, s.searched_at, s.picked_zone_id, s.destination_label
     FROM search s
     LEFT JOIN outcome o ON o.zone_id = s.picked_zone_id
     WHERE s.picked_zone_id IS NOT NULL
       AND s.searched_at >= ?
       AND (o.zone_id IS NULL OR o.last_outcome_at < s.searched_at)
     ORDER BY s.searched_at DESC
     LIMIT 1`,
    since,
  );
  if (!row) return null;
  return {
    searchId: row.id,
    zoneId: row.picked_zone_id,
    pickedAtIso: row.searched_at,
    destinationLabel: row.destination_label,
  };
}
