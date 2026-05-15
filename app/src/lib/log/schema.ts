// Personal-log schema (brief §7). Stored locally via expo-sqlite, never synced.
//
// Two tables:
//   • search  — one row per user-initiated search (every result set persisted as JSON for later analysis).
//   • outcome — one row per zone the user has acted on; `last_outcome` drives the displayConfidence override (D31).
//
// All timestamps are stored as ISO-8601 TEXT — easy to compare lexicographically and trivially exported.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS search (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  searched_at TEXT NOT NULL,
  destination_lat REAL,
  destination_lng REAL,
  destination_label TEXT,
  mode TEXT NOT NULL,
  time_mode TEXT NOT NULL,
  arrival_time TEXT,
  max_walk_minutes INTEGER,
  include_bus INTEGER,
  picked_zone_id TEXT,
  raw_results_json TEXT
);

CREATE INDEX IF NOT EXISTS search_searched_at_idx ON search (searched_at DESC);

CREATE TABLE IF NOT EXISTS outcome (
  zone_id TEXT PRIMARY KEY,
  parked_count INTEGER NOT NULL DEFAULT 0,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  last_outcome TEXT,
  last_outcome_at TEXT,
  hours_observed TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS outcome_last_at_idx ON outcome (last_outcome_at DESC);
`;

/** Internal database filename. Bumping this name = clean slate; bumping the schema = additive ALTER. */
export const DATABASE_NAME = 'parkfree-log.db';
