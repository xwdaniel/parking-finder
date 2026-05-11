# ParkFree — backend (Fastify + TypeScript + PostGIS)

Step 2 of the build order in `../ParkFree_ClaudeCode_Brief.md` §10: server skeleton +
database connection + health check, deployable to Fly.io. Routing logic (§5) and the data
pipeline (§6) land in later steps.

## Layout

```
backend/
  src/
    server.ts            # Fastify app factory + listen; buildServer() is importable for tests
    config.ts            # env parsing (DATABASE_URL, PORT, PGSSL, TFL_APP_KEY, …)
    db/pool.ts           # shared pg Pool + checkDb()
    routes/health.ts     # GET /health — DB connectivity + PostGIS presence
  db/schema.sql          # cpz / zone / red_route DDL (brief §6.3–6.4) — apply manually for now
  ingestion/             # steps 3–5 (see ingestion/README.md) — empty stub for now
  Dockerfile  fly.toml   # Fly.io deploy
  .env.example
```

## Database setup

The project uses a **Supabase** (or **Neon**) free-tier Postgres+PostGIS as both the dev *and* production DB.

1. Create a free Supabase project → enable the **PostGIS** extension (Dashboard → Database → Extensions → search "postgis" → enable) → copy the **Session pooler** connection string (Project Settings → Database → Connection string → mode "Session", port 5432, host `aws-0-<region>.pooler.supabase.com`). Session mode (not Transaction/pgBouncer) is the right fit for a long-running server holding a small connection pool — it behaves like a real per-session connection (no prepared-statement caveats) and is IPv4 so it also works from Fly.io. Neon: create a project, `create extension postgis;`, copy the connection string.
2. `cd backend && cp .env.example .env`, set `DATABASE_URL=…` (leave `PGSSL` unset so SSL stays on for the managed DB).
3. `npm install && npm run db:migrate` — applies `db/schema.sql` (idempotent; no `psql` needed).
4. `npm run build:static-data && npm run fetch:felt-cpz` then `npm run ingest:all` — populates `cpz` / `cpz_bay` / `cpz_area` (Camden API + WF/Haringey/TH static JSON + Felt area polygons). `npm run db:status` shows what's loaded.
5. `npm run dev` → `curl -s localhost:3000/health | jq` →
   ```json
   { "status": "ok", "time": "…", "db": { "connected": true, "postgis": "3.4.2", "serverVersion": "16.4" } }
   ```
   `/health` returns **503** with `status:"degraded"` if PostGIS isn't enabled, `status:"down"` if the DB is unreachable.

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
| `npm run ingest:all` | run every CPZ adapter (camden, wf, haringey, tower-hamlets, cpz-areas) |
| `npm run ingest:camden` / `:wf` / `:haringey` / `:tower-hamlets` / `:cpz-areas` | run one CPZ adapter (needs `DATABASE_URL`) |

## Tests

Run with `npm test`. No database required — DB-dependent paths are exercised against a
deliberately-unreachable address (`src/testEnv.ts`), and the ingest's SQL writes are left
for integration testing once a PostGIS instance exists.

| File | Covers |
|---|---|
| `src/server.test.ts` | `buildServer()` via `inject`: `/` banner, `/health` → 503 when DB down, CORS reflection, 404 |
| `src/ingestion/socrata.test.ts` | `fetchSocrataAll` — pagination (incl. exact-multiple), HTTP-error rejection, `X-App-Token`, `$select`/`$where`/`$order` |
| `src/ingestion/hours.test.ts` | `parseTimeRanges`, `camdenHours`, `haringeyHours` — council hours → OSM `opening_hours` syntax |
| `src/ingestion/static.test.ts` | `parseStaticDataFile` (validation), `staticZonesToCpzRecords`; + every committed `static-data/*.json` parses with plausible hours |
| `src/ingestion/sources/camden-transform.test.ts` | `transformCamdenZones` (group by name, union polygons, derive hours), `transformCamdenBays` |
| `src/ingestion/sources/cpz-areas.test.ts` | `featureCollectionToAreaRecords` (GeoJSON FC → area records, validation); + the committed `*-cpz-polygons.geojson` parse |
