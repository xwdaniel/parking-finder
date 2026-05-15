# ParkFree

> Find free London street parking near well-connected Tube/Overground/DLR/Elizabeth-line stops, then route via public transport to the destination.

Solo-user MVP. iOS only (Expo managed workflow + free Apple ID side-load). Tests the hypothesis that a time-aware inclusion model + composite scoring beats the existing Streetview-and-memory approach to finding free parking in London.

The MVP build (§10 of [`ParkFree_ClaudeCode_Brief.md`](./ParkFree_ClaudeCode_Brief.md), steps 0–14) is **complete**. From here the project shifts into the 1-month real-use validation period defined in §11.

---

## What's in the repo

```
parking-finder/
  ParkFree_ClaudeCode_Brief.md   the spec — concept, screens, routing, data pipeline, build order
  decisions.md                   D1..D32 — the *why* behind every non-obvious choice
  CLAUDE.md                      orientation for Claude Code sessions
  backend/                       Fastify + TypeScript + PostgreSQL/PostGIS — see backend/README.md
  app/                           Expo SDK 52 (React Native, iOS only) — see app/README.md
  osm_spike/                     Step 0 borough recon (reference data, not active code)
```

Two-package monorepo with **no root `package.json`** — `npm` commands must run from `backend/` or `app/`.

---

## Two modes

- **Park near destination** — find unrestricted street parking within a user-chosen walk radius. No transit leg.
- **Park + Tube** — find free street parking near a well-connected stop, then route via TfL Journey Planner to the destination.

A street counts as "free parking" only if no controlled-parking-zone restriction is operational *at the user's arrival time*. The whole codebase is organised around this single decision.

---

## Quick start

```bash
# Backend — needs a PostGIS database (Supabase / Neon free tier or local Docker postgis/postgis:16-3.4)
cd backend
cp .env.example .env                  # set DATABASE_URL; optionally TFL_APP_KEY
npm install
npm run db:migrate                    # apply db/schema.sql (idempotent)
npm run ingest:all                    # ~10–12 min: Camden API + WF/Haringey/TH static + OSM streets + TfL stops
npm run dev                           # tsx watch src/server.ts → http://localhost:3000
curl -s localhost:3000/health | jq

# App — Expo managed workflow, iOS only
cd ../app
cp .env.example .env                  # Mapbox tokens; optional, app degrades to a no-map fallback without
npm install
npm run prebuild                      # expo prebuild --platform ios --clean (first time / after native module changes)
npm run ios                           # build + run on a connected iPhone or simulator
```

Subsystem-level setup details — DB provisioning, Fly.io deploy, ingestion specifics, Mapbox / TfL / Google Places key sourcing — live in [`backend/README.md`](./backend/README.md), [`backend/src/ingestion/README.md`](./backend/src/ingestion/README.md), and [`app/README.md`](./app/README.md).

---

## Architecture in one paragraph

A single pure decision function — `evaluateZone(zone, t) → {eligible, confidence, reason}` in `backend/src/zones/inclusion.ts` — is reused by all three endpoints (`GET /zones`, `GET /search/walk`, `GET /search/transit`) so that the eligibility rules can't drift between the map view and the ranked search. CPZ data comes from per-borough adapters (shared transport plumbing + a thin per-borough module under `backend/src/ingestion/sources/`) because no consolidated London-wide CPZ source exists. Streets without a covering adapter are not silently treated as free — they surface at the 0.4 confidence tier with a borough-scoped warning banner. The transit pipeline anchors on a small `tfl_stop` table for the K=3 nearest stops per zone, fans out parallel `/Journey/JourneyResults` calls (concurrency 6, cached in-memory), and scores `time*0.40 + walk*0.40 + confidence*0.20`. On the device, a `@gorhom/bottom-sheet` over a Mapbox `MapView` drives a hybrid map-plus-list UX, and an on-device `expo-sqlite` personal log records every search and outcome — never synced — as the validation instrument for §11.

For the full picture, read the brief; for the reasoning behind specific choices, read `decisions.md`.

---

## Status

| Layer | State |
|---|---|
| Backend `GET /zones` / `/search/walk` / `/search/transit` | shipped, tested |
| Ingestion (Camden API + WF/Haringey/TH static + OSM + TfL stops) | shipped |
| App: Search → Map+Results (walk + transit) → personal log | shipped |
| Validation period (brief §11) | not started — 5 uses across ≥3 unfamiliar destinations, ≥1 in each non-Camden committed borough, zero PCNs |

Out of scope until the hypothesis validates: Android, CarPlay-native UI, App Store / TestFlight, push notifications, crowdsource reporting, per-bay precision. See brief §12.
