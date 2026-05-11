# Data ingestion (build-order steps 3–5)

Per-borough CPZ adapters + OSM street ingestion. Each adapter emits the common shapes in
`src/ingestion/types.ts` (`CpzRecord` / `CpzBayRecord`) and writes to the tables in
`backend/db/schema.sql`. Layout (matches brief §6.1 and `osm_spike/borough_recon.md`):

```
src/ingestion/
  socrata.ts                       # shared Socrata client: HTTP, $limit/$offset pagination, SoQL          ✅ step 3
  hours.ts                         # council hours → OSM opening_hours (parseTimeRanges, camdenHours, haringeyHours)
  static.ts                        # canonical static-data shape + loader + staticZonesToCpzRecords          ✅ step 4
  cpz-store.ts                     # DB writes for the `cpz` table: writeCpzRecords, ingestStaticBorough
  util.ts                          # slug()
  types.ts                         # CpzRecord, CpzBayRecord
  sources/
    camden-transform.ts            # pure transforms for Camden's vf6e-iymu / 7hiv-3r9k rows                  ✅ step 3
    camden.ts                      # Camden adapter: fetch + transform + write to cpz / cpz_bay               ✅ step 3
    waltham-forest.ts              # static-data/waltham-forest.json → cpz; streets join via OSM parking:*:zone=*  ✅ step 4
    haringey.ts                    # static-data/haringey.json → cpz (geom NULL); polygon join added in step 4c   ✅ step 4 (hours only)
    tower-hamlets.ts               # static-data/tower-hamlets.json → cpz; spatial join — step 4b (hours) + 4c (polygons)
  scripts/
    build-wf-static.ts             # osm_spike/waltham_forest_cpz_hours.json → static-data/waltham-forest.json
    build-haringey-static.ts       # council all-cpz-hours rows → static-data/haringey.json
  hours.test.ts  static.test.ts  socrata.test.ts  sources/camden-transform.test.ts   # node:test (no DB)
  # later: osm.ts (Overpass + ST_LineMerge → zone, step 5), red-routes.ts (TLRN → red_route), sync.ts (orchestrator)
backend/static-data/               # waltham-forest.json, haringey.json (committed; built by `npm run build:static-data`)
```

## Camden adapter (step 3) — DONE

- `vf6e-iymu` (CPZ sub-zone polygons + Mon–Fri/Sat control hours) → `cpz` (one row per zone *name*; sub-zone polygons sharing a name are unioned; `hours` derived via `camdenHours`).
- `7hiv-3r9k` (per-bay restriction + LineString geometry) → `cpz_bay` (raw `times_of_operation` kept; normalised on consumption — per-bay refinement of the time-aware query is a later enhancement).
- `source_type` / `source` = `camden_socrata`. Idempotent: transactional delete-then-insert scoped to the source.

## Static-JSON adapters (step 4) — Waltham Forest DONE, Haringey hours DONE

- Canonical shape + validation in `static.ts`; data files in `backend/static-data/` (see that dir's README), rebuilt with `npm run build:static-data`.
- **Waltham Forest** — `source_type='waltham_forest_static'`, 86 zones (60 with hours), `geom` NULL; streets join at query time via OSM tags (`zone.osm_zone_tag = cpz.source_zone_id`). Run: `npm run ingest:wf`.
- **Haringey** — `source_type='haringey_static'`, 45 zones (42 with hours), `geom` NULL. **Inert until step 4c**: no OSM zone tags and no polygons yet, so these rows match no street; step 4c sources polygons and `UPDATE cpz SET geom = …`. Run: `npm run ingest:haringey`.
- **Tower Hamlets** — step 4b builds `static-data/tower-hamlets.json` (scrape Traffic Orders + prose); step 4c adds polygons.

```bash
# 1. point DATABASE_URL at a PostGIS DB and apply the schema
psql "$DATABASE_URL" -f db/schema.sql
# 2. (re)build the static-data files, then run the adapters
npm run build:static-data
npm run ingest:camden && npm run ingest:wf && npm run ingest:haringey
# prod: npm run build && node dist/ingestion/sources/camden.js  (etc.)
```

## Confidence tiers (brief §6.5)

Camden (API source) ⇒ **1.0**; static-JSON hit with hours ⇒ **0.8**; OSM zone tag but hours
uncatalogued ⇒ **0.6** ("verify with signage"); borough with no adapter ⇒ **0.4** (geometry-only
+ warning banner); active CPZ at the user's arrival time, or a TfL Red Route ⇒ **excluded**.
