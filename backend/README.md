# ParkFree — backend (Fastify + TypeScript + PostGIS)

Build order in `../ParkFree_ClaudeCode_Brief.md` §10: server skeleton + DB + health check
(step 2), the CPZ/OSM/TfL-stop data pipeline (steps 3–5, 10, see `src/ingestion/README.md`),
the `GET /zones` time-aware query (step 6), the `GET /search/walk` ranked search (step 9),
and the `GET /search/transit` ranked Park+Tube search with TfL Journey integration (step 10).

## Layout

```
backend/
  src/
    server.ts              # Fastify app factory + listen; buildServer() is importable for tests
    config.ts              # env parsing (DATABASE_URL, PORT, PGSSL, TFL_APP_KEY, …) + TZ=Europe/London default
    db/pool.ts             # shared pg Pool + checkDb();  db/{migrate,reset,status}.ts
    routes/health.ts       # GET /health — DB connectivity + PostGIS presence
    routes/zones.ts        # GET /zones?bbox=&t= — viewport-clipped GeoJSON, time-aware inclusion (brief §6.2)
    routes/search.ts       # GET /search/walk (§5.1) + GET /search/transit (§5.2) — ranked top-10 results
    tfl/journey.ts         # TfL /Journey/JourneyResults wrapper + in-memory LRU cache (§9) — see D29
    tfl/disruption.ts      # pure: leg-disruption → tier (suspended | severe | minor | none, §5.4 / D12)
    zones/inclusion.ts     # pure: per-zone { eligible, confidence, reason } from a query-time snapshot (§6.2/§6.5)
    zones/opening-hours.ts # `opening_hours.js` wrapper — is a CPZ operational at time T?
    ingestion/             # steps 3–5: CPZ adapters + OSM zone ingestion (see ingestion/README.md)
  db/schema.sql            # cpz / cpz_bay / zone / cpz_area / red_route DDL (brief §6.3–6.4) — applied by `npm run db:migrate`
  static-data/             # *.json (council CPZ hours) + *-cpz-polygons.geojson (Felt areas) — committed
  Dockerfile  fly.toml     # Fly.io deploy
  .env.example
```

## API

| Route | |
|---|---|
| `GET /` | service banner |
| `GET /health` | DB connectivity + PostGIS presence (used by Fly.io's health check) |
| `GET /zones?bbox=minLon,minLat,maxLon,maxLat&t=<ISO8601>` | every `zone` overlapping the viewport bbox, as a GeoJSON `FeatureCollection`. Each feature carries time-aware `eligible` / `confidence` (0.4 / 0.6 / 0.8 / 1.0) / `reason`, plus `zoneUnknown` (verify-with-signage badge), `boroughHasAdapter` (false ⇒ 0.4-tier warning banner), `hours` (the governing CPZ hours when a single known one applies), `hoursSpread` (the borough's CPZ-hours spread, for the `in_cpz_area` case), `activeCpz` (set only when excluded by an operational CPZ) and `cpz[]` (matched zone codes). `t` defaults to now and is read as London wall-clock time. See brief §6.2 / §6.5. |
| `GET /search/walk?lat=&lng=&maxWalkMinutes=&t=<ISO8601>` | ranked walk-mode candidates (brief §5.1): the top 10 *eligible* zones within `maxWalkMinutes * 80` metres of the destination, scored `walkScore*0.7 + confidence*0.3` (D5/D28). Each result wraps the same zone feature shape as `/zones` plus `walkPoint:{lat,lng}` (the `ST_ClosestPoint` on the zone closest to the destination) and `walkMinutes` (the great-circle distance to that point, divided by 80). Empty list ⇒ no eligible zones in radius — the UI suggests widening the slider (never silently expand, D3). |
| `GET /search/transit?lat=&lng=&maxWalkMinutes=&t=&timeMode=now\|arrive_by&includeBus=1\|0` | ranked Park+Tube candidates (brief §5.2 / D29): eligible zones within 1.5 km of destination, K=3 nearest TfL stops per zone (from `tfl_stop` — see `ingest:tfl-stops`), parallel `/Journey/JourneyResults` calls per (zone, stop), scored `time*0.40 + walk*0.40 + confidence*0.20`, dedupe per zone, top 10. Disruption tiers per §5.4 / D12 (`suspended` filters the route, `severe` × 0.7, `minor`/none kept). `503` when `TFL_APP_KEY` is missing — the frontend's transit detail surfaces an actionable hint. |

## Database setup

The project uses a **Supabase** (or **Neon**) free-tier Postgres+PostGIS as both the dev *and* production DB.

1. Create a free Supabase project → enable the **PostGIS** extension (Dashboard → Database → Extensions → search "postgis" → enable) → copy the **Session pooler** connection string (Project Settings → Database → Connection string → mode "Session", port 5432, host `aws-0-<region>.pooler.supabase.com`). Session mode (not Transaction/pgBouncer) is the right fit for a long-running server holding a small connection pool — it behaves like a real per-session connection (no prepared-statement caveats) and is IPv4 so it also works from Fly.io. Neon: create a project, `create extension postgis;`, copy the connection string.
2. `cd backend && cp .env.example .env`, set `DATABASE_URL=…` (leave `PGSSL` unset so SSL stays on for the managed DB).
3. `npm install && npm run db:migrate` — applies `db/schema.sql` (idempotent; no `psql` needed).
4. `npm run build:static-data && npm run fetch:felt-cpz` then `npm run ingest:all` — populates `cpz` / `cpz_bay` / `cpz_area` (Camden API + WF/Haringey/TH static JSON + Felt area polygons) and `zone` (OSM streets, contiguity-grouped). `npm run db:status` shows what's loaded. (`ingest:all` is ~10–12 min — mostly Camden's per-bay rows; the OSM step adds ~1–2 min.)
5. `npm run dev` → `curl -s localhost:3000/health | jq` →
   ```json
   { "status": "ok", "time": "…", "db": { "connected": true, "postgis": "3.4.2", "serverVersion": "16.4" } }
   ```
   `/health` returns **503** with `status:"degraded"` if PostGIS isn't enabled, `status:"down"` if the DB is unreachable.
   Then e.g. `curl -s 'localhost:3000/zones?bbox=-0.142,51.544,-0.134,51.549&t=2026-05-12T21:00:00' | jq '.meta'` for a viewport's worth of time-aware zones (drop `&t=…` for "now").

For production, `fly secrets set DATABASE_URL=…` (same string) and `fly deploy` (see below).

*Local-only alternative:* `brew install postgresql@16 postgis && brew services start postgresql@16 && createdb parkfree && psql parkfree -c 'create extension postgis'`, then `DATABASE_URL=postgres://localhost:5432/parkfree PGSSL=disable` in `.env`. Or a disposable Docker DB: `docker run --name parkfree-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgis/postgis:16-3.4`.

## Deploy to Fly.io

```bash
fly launch --no-deploy            # creates the app from fly.toml (region lhr)
fly secrets set DATABASE_URL="postgres://…?sslmode=require"
fly secrets set TFL_APP_KEY="…"   # optional until Step 10
fly deploy
fly logs
```
`fly.toml` runs one `shared-cpu-1x` / 256 MB machine that sleeps when idle (`min_machines_running = 0`) and cold-starts on request — fine for solo use; bump to `1` if the cold start ever bites. Health check hits `/health` every 30 s.

## Scripts

| | |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/server.js` (what the Docker image runs) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `node --test` (built-in runner via `tsx`) — no DB needed |
| `npm run db:migrate` | apply `db/schema.sql` to `DATABASE_URL` (idempotent; no `psql` needed) |
| `npm run db:status` | PostGIS version + row counts per table + `cpz` breakdown by source |
| `npm run build:static-data` | regenerate `static-data/{waltham-forest,haringey,tower-hamlets}.json` (hours) |
| `npm run fetch:felt-cpz` | download Felt 2024 CPZ-area polygons → `static-data/*-cpz-polygons.geojson` (~7 min) |
| `npm run ingest:all` | load everything: CPZ adapters (camden, wf, haringey, tower-hamlets, cpz-areas) + OSM (`zone`) |
| `npm run ingest:camden` / `:wf` / `:haringey` / `:tower-hamlets` / `:cpz-areas` / `:osm` / `:tfl-stops` | run one ingest step (needs `DATABASE_URL`; `:tfl-stops` also hits TfL but doesn't require a key) |

## Tests

Run with `npm test`. No database required — DB-dependent paths are exercised against a
deliberately-unreachable address (`src/testEnv.ts`), and the ingest's SQL writes / the
`/zones` happy path are left for integration testing against a live DB (verified manually
per build step — `db:status` shows what's loaded).

| File | Covers |
|---|---|
| `src/server.test.ts` | `buildServer()` via `inject`: `/` banner, `/health` → 503 when DB down, CORS reflection, 404 |
| `src/routes/zones.test.ts` | `GET /zones` — bbox/`t` validation (400s), and 500 when the DB is unreachable (query layer wired up) |
| `src/routes/search.test.ts` | `GET /search/walk` — lat/lng/maxWalkMinutes/`t` validation (400s), and 500 when the DB is unreachable (query layer wired up) |
| `src/routes/search-transit.test.ts` | `GET /search/transit` — TFL_APP_KEY-missing 503, query validation 400s, and 500 when the DB is unreachable |
| `src/tfl/disruption.test.ts` | `classifyDisruption` / `worstTier` — three §5.4 tiers (`suspended` / `severe` / `minor`) from `category` + `description` text |
| `src/tfl/journey.test.ts` | `_internals` — 50m coord snapping + 5-min time bucketing for the §9 cache key, and `normalize()` collapsing legs into walkToStop / transit / walkFromStop minutes |
| `src/ingestion/sources/tfl-stops-transform.test.ts` | `projectStopPoint` / `projectStopPoints` — keep routed stations, dedupe by id, intersect modes with the routed-modes whitelist |
| `src/zones/inclusion.test.ts` | `evaluateZone` — Red Route exclusion, active-CPZ exclusion, the 1.0 / 0.8 / 0.6 / 0.4 confidence tiers (§6.2/§6.5) |
| `src/zones/opening-hours.test.ts` | `cpzActiveAt` / `parseOpeningHours` — weekday/weekend/night windows, split specs, unparseable → null, parse cache |
| `src/ingestion/socrata.test.ts` | `fetchSocrataAll` — pagination (incl. exact-multiple), HTTP-error rejection, `X-App-Token`, `$select`/`$where`/`$order` |
| `src/ingestion/hours.test.ts` | `parseTimeRanges`, `camdenHours`, `haringeyHours` — council hours → OSM `opening_hours` syntax |
| `src/ingestion/static.test.ts` | `parseStaticDataFile` (validation), `staticZonesToCpzRecords`; + every committed `static-data/*.json` parses with plausible hours |
| `src/ingestion/sources/camden-transform.test.ts` | `transformCamdenZones` (group by name, union polygons, derive hours), `transformCamdenBays` |
| `src/ingestion/sources/cpz-areas.test.ts` | `featureCollectionToAreaRecords` (GeoJSON FC → area records, validation); + the committed `*-cpz-polygons.geojson` parse |
| `src/ingestion/sources/osm-transform.test.ts` | `wayToZoneFeature` / `waysToFeatureCollection` — parking-attribute extraction (old + new OSM schemas), short-way drop |
