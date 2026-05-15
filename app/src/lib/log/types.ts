// Personal-log types (brief §7). Mirrors the SQLite schema in `./schema.ts`.

import type { SearchMode, TimeMode } from '../../navigation/types';

/** The six outcomes a user can record post-park (brief §7). */
export type OutcomeKind =
  | 'parked_ok'
  | 'ticketed'
  | 'sign_said_permit'
  | 'unsafe'
  | 'no_space'
  | 'verified_hours';

export interface SearchRow {
  id: number;
  searchedAt: string; // ISO-8601
  destinationLat: number | null;
  destinationLng: number | null;
  destinationLabel: string | null;
  mode: SearchMode;
  timeMode: TimeMode;
  arrivalTime: string | null;
  maxWalkMinutes: number | null;
  includeBus: 0 | 1 | null;
  pickedZoneId: string | null;
  rawResultsJson: string | null;
}

export interface OutcomeRow {
  zoneId: string;
  parkedCount: number;
  ticketCount: number;
  lastOutcome: OutcomeKind | null;
  lastOutcomeAt: string | null; // ISO-8601
  hoursObserved: string | null; // OSM `opening_hours` syntax (verified_hours flow)
  notes: string | null;
}

/** Snapshot of one ranked candidate we persist in `search.raw_results_json` — small enough to store. */
export interface LoggedCandidate {
  rank: number;
  zoneId: string;
  streetName: string | null;
  confidence: number;
  reason: string;
  walkMinutes?: number; // walk mode
  totalMinutes?: number; // transit mode
  stopName?: string | null; // transit mode
  score: number;
}
