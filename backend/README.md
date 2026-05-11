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

## Run locally

```bash
cd backend
cp .env.example .env          # then edit DATABASE_URL

# Local Postgres + PostGIS (one option):
docker run --name parkfree-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgis/postgis:16-3.4
psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'create database parkfree;'
psql "postgres://postgres:postgres@localhost:5432/parkfree" -f db/schema.sql

npm install
npm run dev                   # tsx watch — http://localhost:3000
curl -s localhost:3000/health | jq
```

`GET /health` →
```json
{ "status": "ok", "time": "…", "db": { "connected": true, "postgis": "3.4.2", "serverVersion": "16.4" } }
```
Returns **503** with `status: "degraded"` if PostGIS isn't enabled, or `status: "down"` if the DB is unreachable.

## Managed DB (production)

Use **Supabase** or **Neon** free tier. Both ship PostGIS (Supabase: enable via Dashboard → Database → Extensions; Neon: `create extension postgis;`). Take the pooled connection string (it includes `?sslmode=require`) — leave `PGSSL` unset so SSL stays on.

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
| `npm run build:static-data` | regenerate `static-data/waltham-forest.json` + `haringey.json` |
| `npm run ingest:camden` / `:wf` / `:haringey` | run a CPZ adapter (needs `DATABASE_URL`) |

## Tests

Run with `npm test`. No database required — DB-dependent paths are exercised against a
deliberately-unreachable address (`src/testEnv.ts`), and the ingest's SQL writes are left
for integration testing once a PostGIS instance exists.

| File | Covers |
|---|---|
| `src/server.test.ts` | `buildServer()` via `inject`: `/` banner, `/health` → 503 when DB down, CORS reflection, 404 |
| `src/ingestion/socrata.test.ts` | `fetchSocrataAll` — pagination (incl. exact-multiple), HTTP-error rejection, `X-App-Token`, `$select`/`$where`/`$order` |
| `src/ingestion/hours.test.ts` | `parseTimeRanges`, `camdenHours`, `haringeyHours` — council hours → OSM `opening_hours` syntax |
| `src/ingestion/static.test.ts` | `parseStaticDataFile` (validation), `staticZonesToCpzRecords` (zone → `cpz` row mapping) |
| `src/ingestion/sources/camden-transform.test.ts` | `transformCamdenZones` (group by name, union polygons, derive hours), `transformCamdenBays` |
