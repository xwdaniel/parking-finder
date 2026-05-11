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
    haringey.ts                    # static-data/haringey.json → cpz (geom NULL); per-zone polygon join still pending  ✅ step 4 (hours only)
    tower-hamlets.ts               # static-data/tower-hamlets.json → cpz (geom NULL); per-zone polygon join still pending  ✅ step 4b (hours only)
    cpz-areas-transform.ts         # pure: GeoJSON FeatureCollection → CpzAreaRecord[]
    cpz-areas.ts                   # static-data/<borough>-cpz-polygons.geojson → cpz_area (borough-level CPZ coverage)  ✅ step 4c
    osm-transform.ts               # pure: Overpass ways → GeoJSON Features (with the parking-attribute tuple)
    osm.ts                         # Overpass `out geom;` per borough → ST_ClusterDBSCAN/ST_LineMerge → zone  ✅ step 5
  scripts/
    build-wf-static.ts             # osm_spike/waltham_forest_cpz_hours.json → static-data/waltham-forest.json
    build-haringey-static.ts       # council all-cpz-hours rows → static-data/haringey.json
    build-tower-hamlets-static.ts  # council parking-zones page + CPZ map PDF (hand-converted) → static-data/tower-hamlets.json
    fetch-felt-cpz.ts              # Felt 2024 London-CPZ map → static-data/<borough>-cpz-polygons.geojson  (step 4c)
  *.test.ts  sources/*-transform.test.ts  sources/cpz-areas.test.ts   # node:test (no DB)
  # later: red-routes.ts (TLRN → red_route), sync.ts (orchestrator)
db/{migrate,reset,status}.ts       # apply schema.sql / drop+re-apply / row counts (not under ingestion/ but related)
backend/static-data/               # *.json (hours, built by `npm run build:static-data`) + *-cpz-polygons.geojson (Felt areas, fetched by `npm run fetch:felt-cpz`) — all committed
```

## Camden adapter (step 3) — DONE

- `vf6e-iymu` (CPZ sub-zone polygons + Mon–Fri/Sat control hours) → `cpz` (one row per zone *name*; sub-zone polygons sharing a name are unioned; `hours` derived via `camdenHours`).
- `7hiv-3r9k` (per-bay restriction + LineString geometry) → `cpz_bay` (raw `times_of_operation` kept; normalised on consumption — per-bay refinement of the time-aware query is a later enhancement).
- `source_type` / `source` = `camden_socrata`. Idempotent: transactional delete-then-insert scoped to the source.

## Static-JSON adapters (steps 4 + 4b) — DONE (hours; polygons for the polygon-join boroughs are step 4c)

- Canonical shape + validation in `static.ts`; data files in `backend/static-data/` (see that dir's README), rebuilt with `npm run build:static-data`.
- **Waltham Forest** — `source_type='waltham_forest_static'`, 86 zones (60 with hours), `geom` NULL; streets join at query time via OSM tags (`zone.osm_zone_tag = cpz.source_zone_id`). Run: `npm run ingest:wf`.
- **Haringey** — `source_type='haringey_static'`, 45 zones (42 with hours), `geom` NULL. **Inert until step 4c** (no OSM zone tags, no polygons yet → matches no street). Run: `npm run ingest:haringey`.
- **Tower Hamlets** — `source_type='tower_hamlets_static'`, 19 zones (all with hours; 16 mini-zones + 3 split-out sub-areas), `geom` NULL. **Inert until step 4c**, same as Haringey. Run: `npm run ingest:tower-hamlets`.
## CPZ-area coverage (step 4c) — DONE for what's available; per-zone polygons still a gap

- `npm run fetch:felt-cpz` downloads the Felt 2024 "London CPZ by borough" polygons for Haringey (48) + Tower Hamlets (5, coarse) → `static-data/<borough>-cpz-polygons.geojson` (committed). `npm run ingest:cpz-areas` loads them into `cpz_area`.
- These polygons are **borough-level coverage only** — no per-zone identity. Query semantics (step 6): a street in a `polygon`-join borough that's inside a `cpz_area` polygon ⇒ confidence 0.6, "verify with signage" (which zone's hours apply is unknown — but we *do* have all that borough's zone hours in `cpz`, for UI context); outside all of them ⇒ not in a CPZ.
- **Still pending**: per-zone polygons for Haringey / Tower Hamlets — would attach a specific `cpz` row's hours to a street via `cpz.geom`. No automatable source found (Felt has no zone codes; council web maps have no API) — FOI or a manual web-map scrape.

## OSM zone ingestion (step 5) — DONE

`npm run ingest:osm` — per committed borough: Overpass fetch of `highway=residential|living_street|unclassified` ways with geometry → a GeoJSON FeatureCollection (one Feature per way, carrying `(street_name, parking_lane, parking_condition, osm_zone_tag)`) → one SQL pass that `ST_ClusterDBSCAN`s touching ways within each attribute partition (eps 0 ⇒ "must touch") and dissolves each cluster with `ST_LineMerge` → one `zone` row (`id` = md5 of the sorted way ids; `geom` = MultiLineString; `source_way_ids` = the cluster). Full per-borough rebuild (`DELETE FROM zone WHERE borough = $1` then INSERT, in a transaction). WF zones get `osm_zone_tag` populated — that's what the query-time join `zone.osm_zone_tag = cpz.source_zone_id` uses to attach WF CPZ hours.

```bash
# 0. point DATABASE_URL at a PostGIS DB and migrate
npm run db:migrate                                        # applies db/schema.sql (idempotent; db:reset to drop + re-apply)
# 1. (re)build/fetch the static data
npm run build:static-data && npm run fetch:felt-cpz       # fetch:felt-cpz is ~7 min, ~1300 polite requests
# 2. load everything (CPZ adapters + OSM) — or run a single ingest:<x>
npm run ingest:all                                        # camden, wf, haringey, tower-hamlets, cpz-areas, osm
npm run db:status
# prod: npm run build && node dist/ingestion/sources/camden.js  (etc.)
```

## Confidence tiers (brief §6.5)

Camden (API source) ⇒ **1.0**; static-JSON hit with hours ⇒ **0.8**; OSM zone tag but hours
uncatalogued ⇒ **0.6** ("verify with signage"); borough with no adapter ⇒ **0.4** (geometry-only
+ warning banner); active CPZ at the user's arrival time, or a TfL Red Route ⇒ **excluded**.
