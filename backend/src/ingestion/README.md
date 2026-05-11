# Data ingestion (build-order steps 3–5)

Per-borough CPZ adapters + OSM street ingestion. Each adapter emits the common shapes in
`src/ingestion/types.ts` (`CpzRecord` / `CpzBayRecord`) and writes to the tables in
`backend/db/schema.sql`. Layout (matches brief §6.1 and `osm_spike/borough_recon.md`):

```
src/ingestion/
  socrata.ts                       # shared Socrata client: HTTP, $limit/$offset pagination, SoQL
  hours.ts                         # council hours strings → OSM opening_hours syntax (parseTimeRanges, camdenHours)
  types.ts                         # CpzRecord, CpzBayRecord
  sources/
    camden-transform.ts            # pure transforms for Camden's vf6e-iymu / 7hiv-3r9k rows   ✅ step 3
    camden.ts                      # Camden adapter: fetch + transform + write to cpz / cpz_bay  ✅ step 3
    waltham-forest.ts              # static-data/waltham-forest.json → cpz, join via OSM parking:*:zone=*   (step 4)
    haringey.ts                    # static-data/haringey.json → cpz; spatial-intersection join (no OSM zone tags)   (step 4, polygons step 4c)
    tower-hamlets.ts               # static-data/tower-hamlets.json → cpz; spatial-intersection join   (step 4b, polygons step 4c)
  hours.test.ts                    # node:test — hours parsing
  sources/camden-transform.test.ts # node:test — Camden row transforms (real-shape fixtures)
  # later: osm.ts (Overpass + ST_LineMerge → zone, step 5), red-routes.ts (TLRN → red_route), sync.ts (orchestrator)
backend/static-data/               # (created in step 4) waltham-forest.json, haringey.json, tower-hamlets.json
```

## Camden adapter (step 3) — DONE

- `vf6e-iymu` (CPZ sub-zone polygons + Mon–Fri/Sat control hours) → `cpz` (one row per zone *name*; sub-zone polygons sharing a name are unioned; `hours` derived via `camdenHours`).
- `7hiv-3r9k` (per-bay restriction + LineString geometry) → `cpz_bay` (raw `times_of_operation` kept; normalised on consumption — per-bay refinement of the time-aware query is a later enhancement).
- `source_type` / `source` = `camden_socrata`. Idempotent: transactional delete-then-insert scoped to the source.

```bash
# 1. point DATABASE_URL at a PostGIS DB and apply the schema
psql "$DATABASE_URL" -f db/schema.sql
# 2. run it
npm run ingest:camden          # dev (tsx)   |   npm run build && npm run ingest:camden:prod
```

## Confidence tiers (brief §6.5)

Camden (API source) ⇒ **1.0**; static-JSON hit with hours ⇒ **0.8**; OSM zone tag but hours
uncatalogued ⇒ **0.6** ("verify with signage"); borough with no adapter ⇒ **0.4** (geometry-only
+ warning banner); active CPZ at the user's arrival time, or a TfL Red Route ⇒ **excluded**.
