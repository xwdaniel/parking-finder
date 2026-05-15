# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**ParkFree** — a solo-user MVP that finds free London street parking near well-connected Tube/Overground/DLR/Elizabeth-line stops, then routes via TfL Journey Planner. The hypothesis it tests: a time-aware inclusion model + composite scoring beats the user's existing Streetview-and-memory method.

Two load-bearing documents in the repo root:

- `ParkFree_ClaudeCode_Brief.md` — the spec. §10 is the 14-step build order (all steps now Done). §4 is screens, §5 routing, §6 the data pipeline, §7 the personal log, §11 success criteria.
- `decisions.md` — D1..D32, the *why* behind every non-obvious choice. Read the relevant D-entry before changing anything that touches it (the brief tells you *what*, decisions.md tells you *why*).

When you make a change that revisits one of these decisions, update decisions.md.

## Repo layout

This is a **two-package monorepo with no root package.json**. Running `npm` at the repo root walks up to `~/package.json` — always `cd backend` or `cd app` first.

- `backend/` — Node 22 + TypeScript + Fastify + PostgreSQL/PostGIS. Ingestion CLI scripts, three API routes (`/zones`, `/search/walk`, `/search/transit`), TfL Journey wrapper.
- `app/` — Expo SDK 52 managed workflow (iOS only). React Navigation + @gorhom/bottom-sheet + Mapbox + React Query.
- `osm_spike/` — reference data from Step 0 (borough recon / OSM coverage spike). Not active code; useful only as a source for `backend/static-data/*.json` regeneration.

## Commands

### Backend (`cd backend`)

```bash
npm install
cp .env.example .env                 # set DATABASE_URL (+ optionally TFL_APP_KEY)
npm run db:migrate                   # apply db/schema.sql (idempotent — no psql needed)
npm run ingest:all                   # ~10–12 min — Camden API + WF/Haringey/TH static + Felt areas + OSM streets + TfL stops
npm run dev                          # tsx watch src/server.ts
npm test                             # node --test via tsx — no DB needed
npm run typecheck                    # tsc --noEmit
npm run db:status                    # PostGIS version + row counts per table; what's loaded
```

Run a **single backend test file**: `node --import tsx --test src/zones/inclusion.test.ts` (or any path from the explicit list in `package.json`'s `"test"` script).

Individual ingest steps: `npm run ingest:camden | :wf | :haringey | :tower-hamlets | :cpz-areas | :osm | :tfl-stops`. `npm run build:static-data` rebuilds the council-hours JSON in `static-data/`; `npm run fetch:felt-cpz` pulls the Felt 2024 CPZ-area polygons.

### App (`cd app`)

```bash
npm install
npx expo install --fix               # reconcile any drift with the installed Expo SDK
npm run prebuild                     # expo prebuild --platform ios --clean (first run / after native module changes)
npm run ios                          # build + run on connected iPhone or simulator
npm run start:go                     # Expo Go — works when no custom native modules are active
npm run typecheck                    # tsc --noEmit
npx expo-doctor                      # 17 checks — must pass before claiming a build is clean
npx expo export --platform ios       # bundle dry-run — surfaces import errors that typecheck misses
```

There is **no app-side test runner installed** by design (Step 14 closed without adding one). Pure functions in `app/src/lib/log/personal.ts` etc. are organised to be testable in principle later. The trio `typecheck + expo-doctor + expo export` is the "build verified" gate every commit has had to pass.

## Architecture — the big picture

### What every change has to respect

The whole project is organised around one decision: **a street is only "free" if no controlled-parking-zone (CPZ) restriction is operational *at the query time T***. This forces an evaluate-on-query model — not a precomputed "free streets" set. Three consequences ripple through the codebase:

1. **Time-aware inclusion is a pure function**, `evaluateZone(zone, t) → {eligible, confidence, reason}` in `backend/src/zones/inclusion.ts`. Every route (`/zones`, `/search/walk`, `/search/transit`) reuses it — no path duplicates the rules. CPZ hours are parsed via `opening_hours.js` (server pinned to `TZ=Europe/London`).
2. **No consolidated London CPZ source exists** — each borough is its own adapter. The committed set is Camden + Waltham Forest + Haringey + Tower Hamlets. Adding a borough is a real (multi-hour) job; adapter-less boroughs are not silently treated as free (they show at the 0.4 confidence tier with a warning banner).
3. **Confidence is a tier, not a weight.** 1.0 (Camden API) / 0.8 (WF tag-join, static JSON) / 0.6 (`cpz_area` borough-wide, "verify with signage") / 0.4 (no adapter). The UI tier comes from `tierOf(properties)` in `MapResultsScreen.tsx`. The tier drives map colours, badges, and warning banners — never a continuous gradient. D5 / D13 / D23 / D25 cover this.

### Backend (`backend/src/`)

- `server.ts` exports `buildServer()` (used by both `start()` and tests via `app.inject(...)`).
- `routes/zones.ts` — `GET /zones?bbox=&t=`: every zone overlapping the bbox, each tagged with its `evaluateZone` verdict.
- `routes/search.ts` — `GET /search/walk` (§5.1) and `GET /search/transit` (§5.2). Both endpoints live in one file because they share the helpers (`parseFloatish`, `parseTime`, `parseBool`, `activityOf`, `buildMatchedCpz`, `zonePropertiesFromIncl`); D28 explains why they aren't merged.
- `zones/inclusion.ts` + `zones/opening-hours.ts` — the pure decision function and its `opening_hours.js` wrapper.
- `tfl/journey.ts` — TfL `/Journey/JourneyResults` HTTP wrapper + an in-memory LRU keyed on `(zonePoint @ 50 m grid, dest @ 50 m grid, time @ 5-min bucket, timeIs, includeBus)`, 256-entry max, 5-min TTL. The HTTP key is read via a getter on `config.tflAppKey` (not a captured const) so tests can toggle `TFL_APP_KEY` between `buildServer()` calls.
- `tfl/disruption.ts` — pure classifier for the four §5.4 tiers (`suspended` filters the journey, `severe` × 0.7 score, `minor`/`none` kept).
- `ingestion/` — per-borough adapters. **The architectural pattern (D24) is shared transport plumbing + a thin per-borough module**: `socrata.ts` / `static.ts` are the transports; `sources/<borough>.ts` does I/O and DB writes; `sources/<borough>-transform.ts` is the pure row mapping (unit-tested via `node:test`). Every adapter writes to the shared `cpz` / `cpz_bay` / `cpz_area` / `zone` tables with a `source_type` discriminator. **Always split a new adapter into `.ts` (I/O) + `-transform.ts` (pure).**
- `db/schema.sql` is the single source of truth for the DB. Applied idempotently by `db:migrate`. Tables: `cpz`, `cpz_bay`, `cpz_area`, `zone`, `tfl_stop`, `red_route`.

### App (`app/src/`)

- `App.tsx` providers: `GestureHandlerRootView` → `SafeAreaProvider` → `PersistQueryClientProvider` (AsyncStorage persister, 24 h maxAge, buster `v1`) → `NavigationContainer`.
- `navigation/RootNavigator.tsx` — bottom tabs: `Park` (stack: Search → MapResults) and `Log`.
- `screens/MapResultsScreen.tsx` is the central screen (~1700 lines). It contains *both* the walk and transit pipelines — they share confidence-tier rendering, map shapes, the bottom sheet, the personal-log wiring, and the OutcomePrompt overlay. Keep both branches in sync when changing tier/badge/Navigate behaviour.
- `screens/SearchScreen.tsx` — destination input (Google Places when `extra.googlePlacesApiKey` set, else Apple on-device geocoder via `expo-location` — D26), mode/time toggles, walk slider, bus switch, and a "Use my current location" button (D32 GPS opt-in path).
- `lib/api.ts` — typed mirror of the three backend endpoints. **The frontend must never diverge from `backend/src/routes/*.ts` types here.**
- `lib/log/` — personal log (brief §7). `schema.ts` is the SQLite DDL, `db.ts` the lazy singleton, `log.ts` the I/O API (`recordSearch` / `recordPick` / `recordOutcome` / `listSearches` / `listOutcomes` / `getPendingPick`), and `personal.ts` the pure override logic (D31). Personal data is on-device, never synced.
- `components/OutcomePrompt.tsx` — native `<Modal>` post-park "How did it go?" sheet. Used a `<Modal>` rather than a second `@gorhom/bottom-sheet` because two stacked sheets fight over gestures.
- `hooks/use{Zones,WalkSearch,TransitSearch,Outcomes}.ts` — React Query bindings; persist via `parkfree.rq-v1`.

### Config / secrets

- `backend/.env` (gitignored): `DATABASE_URL`, optionally `TFL_APP_KEY` (registered at `api-portal.tfl.gov.uk`; free; the transit route returns 503 without it, walk-mode is unaffected), `PGSSL=disable` for local Postgres.
- `app/.env` (gitignored): `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (the `pk.*` public token, runtime) and `MAPBOX_DOWNLOAD_TOKEN` (the `sk.*` secret token, consumed by `@rnmapbox/maps` config plugin at prebuild). Without either, the map renders a no-map fallback (D27).
- `app/app.json` contains a non-secret `extra.googlePlacesApiKey` slot if Google Places is wanted; absent → Apple on-device geocoder fallback.
- Server is pinned to `TZ=Europe/London` (set in `config.ts`) so `opening_hours.js` evaluates against London wall-clock.

## Tests

Backend tests run on the Node built-in test runner via `tsx` — no jest, no live DB. DB-dependent routes are tested by pointing at an unreachable address (`src/testEnv.ts`) and asserting the failure shape; the SQL writes themselves are verified manually with `npm run db:status` + `curl /zones?...` after a build step.

The `"test"` script in `backend/package.json` is an **explicit list of test files** (not a glob). When adding a new test, append it to that list — otherwise it won't run. Then verify the count goes up (e.g. `npm test 2>&1 | tail -2` should show a higher pass count).

## Out of scope (don't propose these)

Android, CarPlay-native UI (D15 — both maps apps already have their own CarPlay), App Store / TestFlight distribution (D14 — free Apple ID + 7-day signing refresh), push notifications, crowdsource reporting (D13 — replaced by the personal log), per-bay precision in the time-aware inclusion (deferred). See brief §12 for the full list.
