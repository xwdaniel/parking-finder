# ParkFree — Claude Code Build Brief
*Find free street parking near Tube stops, then route to your destination*

> **Solo-user MVP.** Single developer (Daniel), single device (his iPhone), used primarily for trips planned in advance. Worst-case fallback: existing parking-finding methods (Streetview, memory). The app augments rather than replaces.

---

## 1. App Concept

ParkFree helps a London driver find free street parking near well-connected Tube/Overground/DLR/Elizabeth-line stops, then routes via public transport to their destination. Existing apps don't combine free street parking + transit proximity + journey planning (see §13).

Two modes:

- **Park near destination** — find unrestricted street parking within a user-chosen walk radius of the destination. No transit leg.
- **Park + Tube** — find free street parking near a well-connected stop, then transit to the destination.

Time toggle (search screen):

- **Leave now** (default) — `timeIs=Departing&time=now`. Captures impromptu drives.
- **Arrive by [picker]** — `timeIs=Arriving`. Captures planned trips.

Walk-distance slider (search screen): default 10 minutes (~800m). Used as max walk-to-destination (walk mode) or max walk-to-stop (transit mode).

Bus toggle (search screen): off by default. When on, adds `mode=bus` to TfL request. Buses noisier and traffic-bound, so opt-in.

The user's intended **arrival time** at the destination is load-bearing for inclusion: a street is only treated as free parking if no controlled-parking-zone restriction is operational *at that time* (see §6).

Every search and outcome is logged locally for the user's own validation loop (§7).

---

## 2. Tech Stack

### Frontend

| Layer | Choice |
|---|---|
| Framework | React Native, **Expo managed workflow** + config plugins (not bare). `expo prebuild` for iOS native config. |
| Platforms | **iOS only for V1.** Android deferred. |
| Maps | `@rnmapbox/maps` (Mapbox SDK) — config plugin works in managed |
| Navigation | `react-navigation` (stack + bottom tabs) |
| Bottom sheet | `@gorhom/bottom-sheet` |
| Location / GPS | `expo-location` (one-shot reads, not continuous) |
| Gestures | `react-native-gesture-handler` |
| State | Zustand |
| Server cache | `@tanstack/react-query` |
| Local persistence | `expo-sqlite` for personal log (search history + outcomes) |

### Backend

| Layer | Choice |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Fastify (lighter than Express, fine for solo) |
| Database | PostgreSQL + PostGIS — **Supabase** or **Neon** free tier |
| Hosting | **Fly.io** free tier (doesn't sleep like Render free) |
| Tile serving | **None.** REST endpoint returns viewport-clipped GeoJSON. Tile server not needed at single-user scale. |
| Hours parsing | `opening_hours.js` — parses OSM `opening_hours` syntax used for CPZ operational hours |

### External APIs and data sources

| Source | Purpose |
|---|---|
| TfL Unified API (free, 500 req/hr) | Journey planning, stop discovery, disruptions |
| TfL Red Routes (TLRN) | Always-restricted roads, London-wide — excluded unconditionally |
| OpenStreetMap Overpass API | Street geometry + parking zone tags (`parking:both:zone=*`) for joining streets to CPZ codes |
| Camden Open Data Portal (Socrata) | Authoritative Camden CPZ polygons + per-zone + per-bay operational hours, refreshed daily |
| Waltham Forest static JSON | `backend/static-data/waltham-forest.json` — 60/86 zones with hours hand-extracted from council PDFs (no API exists for WF). Originating spike copy: `osm_spike/waltham_forest_cpz_hours.json` |
| Haringey CPZ source | Hours: HTML table `haringey.gov.uk/parking/cpzs/all-cpz-hours` → `backend/static-data/haringey.json`. Polygons: TBD (no open-data layer — sub-task: web-map layer / 2018 FOI / Felt 2023). Geometry-only at 0.4 tier until polygons land. |
| Tower Hamlets CPZ source | No structured source — scrape Traffic Orders app `towerhamlets.traffweb.app` + council prose → `backend/static-data/tower-hamlets.json` (per-mini-zone hours). Polygons: TBD (sourced with Haringey's). Full adapter in MVP scope (~1–2 days); geometry-only at 0.4 tier until hours+polygons land. See §3b. |
| Newham CPZ source *(not committed)* | OSM `parking:*:zone=*` at 58% (30 codes) — WF-grade; cheapest future addition if the committed set ever grows. |
| Google Places API | Destination autocomplete + geocoding |
| Mapbox | Map rendering |

**Committed borough set: Camden, Waltham Forest, Haringey, Tower Hamlets.** Islington, Hackney and Newham are named candidate boroughs (§12) — not in MVP scope until V1 validates or a real trip forces one in.

**There is no consolidated London-wide CPZ data source.** TfL does not own or publish CPZ data; each borough does, in wildly varying formats. Per-borough adapters are required (see §6). A borough with OSM street geometry but no CPZ adapter is still shown — at the lowest confidence tier with a prominent warning (§4, §6.5) — never silently treated as all-free.

### Distribution

- **Free Apple ID** (no Apple Developer Program). Side-load via local Xcode.
- **7-day signing refresh required.** Calendar reminder Sunday evenings; refresh ritual = phone connected, Xcode Run, ~2 minutes.
- No TestFlight, no App Store, no push notifications, no Live Activities (last two need paid program).

---

## 3. Step 0 — OSM + CPZ Coverage Spike — DONE (2026-05-09 / 2026-05-10)

The spike validated data feasibility and produced the artefacts referenced in §6. Outputs live under `osm_spike/`:

- `osm_spike_results.md` — borough coverage stats. Camden 2.3% positive OSM tags, Waltham Forest 62.6% (mostly via `parking:both:zone=*` CPZ references). All five of the user's known-free streets failed the brief's *original* binary inclusion rule.
- `cpz_data_sources.md` — survey of authoritative London CPZ sources. Camden has a structured Socrata API; Waltham Forest is PDF-only.
- `waltham_forest_cpz_hours.json` — 60/86 WF zones with operational hours in OSM `opening_hours` syntax. The remaining 26 zones are mostly low-traffic or have PDFs without hours text; treated as `null` and resolved incrementally via the personal log (§7).

**Outcome:** the brief's original CPZ inclusion model was wrong (binary "in CPZ → exclude" rejected all five user-known weekend-free streets). It is replaced with the time-aware model described in §6. Adding new boroughs requires a per-borough adapter — Camden is API-driven, WF is static-JSON-driven, others TBD.

---

## 3b. Step 0b — Borough Recon Spike — DONE (2026-05-11)

Recon on the five candidate boroughs (Haringey + Tower Hamlets committed; Islington / Hackney / Newham named candidates). Full write-up in `osm_spike/borough_recon.md`; artefacts `recon_fetch.sh`, `recon_analyze.mjs`, `recon_analysis.json`, `{borough}_residential.json`.

**OSM `parking:*:zone=*` coverage** (the cheap street→CPZ join that made WF tractable): Haringey 0.3% (3 codes), **Tower Hamlets 0%**, Islington 0%, Hackney 0%, **Newham 58% (30 codes — WF-grade)**. So the tag-join exists for exactly one of these five — Newham, which isn't committed — and **not** for either committed borough.

**CPZ data worlds:**
- **Haringey** — hours are *easy*: a clean HTML table at `haringey.gov.uk/parking/cpzs/all-cpz-hours` (~45 zones, codes + hours, one parse). Polygons are the blocker — no open-data layer; candidates are the council's interactive web map's backing layer, a 2018 FOI request for shapefiles, or Felt's 2023 polygons (no hours, possibly stale). **Verdict: PROCEED** — build `static-data/haringey.json` from the HTML table; open a small polygon-sourcing sub-task; ship geometry-only at the 0.4 tier (§6.5) until polygons land; confidence 0.8 for matched zones thereafter. Note: many zones are Mon–**Sat**, a few Mon–**Sun** (Wood Green Inner 08:00–22:00, Muswell Hill 11:00–13:00, Tottenham Hale North, White Hart Lane, Tower Gardens), and several are event-day zones near Spurs stadium with variable hours.
- **Tower Hamlets** — *the single heaviest data task in the project, and it is in MVP scope* (user's call, 2026-05-11). No structured source; the 16 mini-zones were recently consolidated into 4 parent zones (A/B/C/D), hours vary per mini-zone (mostly Mon–Fri 08:30–17:30, some Mon–Sat, a few with Sunday hours), data lives in the Traffic Orders web app `towerhamlets.traffweb.app` + council prose + a PDF map. No polygon open-data; pre-reorg sources (2014 INSPIRE WMS, Felt 2023) are stale. **Verdict: PROCEED, full adapter** — scrape the Traffic Orders app + council prose into `backend/static-data/tower-hamlets.json` (per-mini-zone hours in OSM `opening_hours` syntax), source polygons alongside Haringey's. Realistic cost ≈ 1–2 days. Until both hours and polygons land, Tower Hamlets renders geometry-only at the 0.4 tier (§6.5) as a transitional state, not the end state.
- **Islington, Hackney** — stay deferred (§12). **Newham** — noted as the cheapest future addition (WF clone), not in scope.

**Ground-truth cross-check:** Antill Road, N15 (Haringey) — exists in OSM, zero parking tags; the South Tottenham CPZ hours regime (`ST` Mon–Fri 10:00–12:00 / `SA` Mon–Sat 08:00–18:30 / `7SS` Mon–Fri 08:00–18:30) is consistent with the user's "free at weekends". Sclater Street, E1 (Tower Hamlets) — not present as `highway=residential` (market street off Brick Lane); Zone A hours + the Brick Lane Sunday market (bay suspensions) make the claim plausible but unverifiable from OSM. The finding both checks share: in Haringey and Tower Hamlets, OSM carries almost no parking signal, so eligibility there will rest entirely on a CPZ adapter that doesn't yet exist as open data — the 0.4 geometry-only tier (§6.5) is the bridge.

---

## 4. Core Screens

1. **Search / Home**
   - Destination input (Google Places autocomplete)
   - Mode toggle: Park near / Park + Tube
   - Time toggle: Leave now / Arrive by [picker]
   - Walk-distance slider (default 10 min)
   - Bus toggle (Park + Tube mode only, off by default)
2. **Map + Results (combined screen)**
   - Mapbox map, viewport-clipped GeoJSON of zones (color-coded by rank)
   - `@gorhom/bottom-sheet` with three snap points:
     - **Collapsed**: top 3 ranked candidates as horizontal cards
     - **Mid**: full ranked list (street name, confidence dots 1–3, total time / walk time)
     - **Expanded**: detailed view of selected zone — restriction notes, hours-of-operation summary if any, walk leg, transit legs (if applicable), disruption badges, **Navigate** button
   - Tap zone polygon → highlight + scroll list to that zone + expand
   - Tap list row → fly map to zone + expand sheet
   - **No numeric score shown to user.** Rank communicated via list order + colour.
   - **"Hours not catalogued" indicator** (per-zone): zones inside an OSM-tagged CPZ but missing from the static JSON / API are surfaced with a dedicated badge ("verify with signage") rather than silently excluded. This is the *within-covered-borough* uncatalogued case (confidence 0.6, §6.5).
   - **Adapter-less-borough warning** (borough-scoped): when ≥1 result falls in a borough with no CPZ adapter at all, a persistent banner at the top of the sheet — *"⚠ Limited data in {borough} — no parking-zone rules available. Check every sign."* — and the borough's area is rendered with a hatched-grey map tint. These zones sit at confidence 0.4 (§6.5). Distinct from the per-zone badge above.
3. **Journey summary (transit mode, sub-view of expanded sheet)** — drive → walk to stop → tube → walk to destination, time per leg, disruption annotations.

**Removed from brief:**
- ~~Zone detail bottom sheet~~ — folded into Map + Results screen.
- ~~Crowdsource Report a space~~ — useless at sample size 1; replaced by personal log (§7).

**Navigate handoff:** opens **Google Maps** for driving directions to the chosen parking point, with **Apple Maps as fallback** if Google Maps is not installed. Driving leg only. Walking leg is self-directed.

```typescript
const url = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
const fallback = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
const target = (await Linking.canOpenURL(url)) ? url : fallback;
await Linking.openURL(target);
```

(Add `comgooglemaps` to `LSApplicationQueriesSchemes` in iOS Info.plist via Expo config plugin.)

Both Google Maps and Apple Maps have native CarPlay support, so when the phone is connected to CarPlay the route automatically appears on the car screen. ParkFree itself does not have a CarPlay-native UI — that requires the paid Apple Developer Program and an Apple-issued entitlement, both out of scope here.

---

## 5. Backend Routing Logic

### 5.1 Park-near-destination flow (no TfL call)

```
input: destination, arrivalTime T, sliderMaxMinutes

1. Query PostGIS: zones within slider-radius of destination
2. Apply time-aware inclusion (§6.2) using T -> `eligible_at_T` zones
3. For each eligible zone:
     walkPoint = ST_ClosestPoint(zone.geom, destination.geom)
     walkMinutes = ST_Distance(walkPoint, destination) / 80
     score = walkScore * 0.7 + confidence * 0.3
       where walkScore = max(0, 1 - walkMinutes / sliderMaxMinutes)
4. Sort desc, return top 10
5. If empty: return empty + suggest user expand slider (do NOT silently expand)
```

### 5.2 Park + Tube flow

```
input: destination, arrivalOrDepartureTime T, sliderMaxMinutes, includeBus

1. Query PostGIS: candidate zones within 1.5km of destination
2. Apply time-aware inclusion (§6.2) using T -> eligible zones
3. For each eligible zone, find K=3 nearest TfL stops
4. For each (zone, stop) pair: zonePoint = ST_ClosestPoint(zone.geom, stop.geom)
5. Call TfL Journey Planner in parallel for (zonePoint -> destination)
6. Parse: walkToStopMinutes, transitMinutes, totalMinutes, line, departStop, disruptions
7. Apply disruption rules (§5.4)
8. Score per surviving result:
     timeScore = max(0, 1 - totalMinutes / 45)
     walkScore = max(0, 1 - walkToStopMinutes / sliderMaxMinutes)
     score = timeScore * 0.40 + walkScore * 0.40 + confidence * 0.20
9. Per zone, keep best-scoring (zone, stop) pair only — dedupe
10. Sort desc, return top 10
```

### 5.3 TfL API call

```
GET https://api.tfl.gov.uk/Journey/JourneyResults/{zoneLat},{zoneLng}/to/{destLat},{destLng}
  ?mode=tube,dlr,overground,elizabeth-line,walking[,bus]
  &timeIs=Departing|Arriving
  &date=YYYYMMDD&time=HHMM
  &walkingSpeed=average
  &app_key=YOUR_TFL_KEY
```

Always pass coordinates, never stop IDs (avoids the Canary Wharf two-stations problem).

### 5.4 Disruption tiers (applied at scoring time)

| Severity | Action |
|---|---|
| Suspended / Part-suspended affecting your stop | **Filter route from results** |
| Severe delays | Annotate red badge, multiply score by 0.7 |
| Minor delays / planned future works | Annotate yellow badge, no score change |

Severity inferred from `journey.legs[].disruptions[].category` and `categoryDescription` text. Build a small classifier (keyword match) — exact rules tuned during testing.

---

## 6. Data Pipeline

### 6.1 Sources, by priority

The data model is **time-aware**: at query time, given the user's intended arrival time T, each candidate street is evaluated against current restrictions and included only if free at T.

Sources, layered:

1. **TfL Red Routes** (always restricted) — exclude unconditionally. London-wide; one source covers every borough.
2. **Per-borough CPZ adapters** — provide CPZ polygons (or OSM zone-tag joins) plus operational hours. Code lives under `backend/src/ingestion/`; each adapter outputs the common schema (§6.3). Architecture: **shared transport plumbing + a thin per-borough module** — `socrata.ts` (HTTP, pagination via `$limit`/`$offset`, SoQL `$where`) for API boroughs, `static.ts` (file loader) for JSON boroughs, then one small module per borough (`sources/<borough>.ts`, with a pure `sources/<borough>-transform.ts` for the row mapping) onto the common schema. Adding an API borough ≈ a few hours (mostly understanding their dataset), not free. Adapters today:
   - **Camden** ✅ (step 3) — `socrata.ts` + `sources/camden.ts` (+ `camden-transform.ts`), API at `opendata.camden.gov.uk`. `vf6e-iymu` (sub-zone polygons + Mon–Fri/Sat hours) → `cpz`, one row per zone *name* (sub-zone polygons sharing a name are unioned; `hours` derived from the two control fields, Sunday structurally unrestricted). `7hiv-3r9k` (per-bay restriction + LineString) → `cpz_bay` (raw `times_of_operation` kept; per-bay refinement of the time-aware query is a later enhancement). Idempotent transactional reload scoped to `source_type='camden_socrata'`. Run: `npm run ingest:camden`.
   - **Waltham Forest** ✅ (step 4) — `static.ts` + `sources/waltham-forest.ts` reads `backend/static-data/waltham-forest.json` (86 zones, 60 with hours; built from the spike by `npm run build:static-data:wf`) → `cpz` rows with `geom` NULL; streets join at query time via OSM tags (`zone.osm_zone_tag = cpz.source_zone_id`, where `osm_zone_tag` ∈ `parking:both:zone=*` / `parking:left:zone=*` / …). The 26 null-hour zones resolve incrementally via the personal-log `verified_hours` flow (§7). Run: `npm run ingest:wf`.
   - **Haringey** ⚠️ (step 4 — hours; step 4c — borough-level coverage) — `sources/haringey.ts` reads `backend/static-data/haringey.json` (45 zones, 42 with hours; built from `haringey.gov.uk/parking/cpzs/all-cpz-hours` by `npm run build:static-data:haringey` via the `haringeyHours` 12-hour-prose parser) → `cpz` rows with `geom` NULL. Haringey has no OSM zone tags and no machine-readable *per-zone* polygons, so those rows don't yet attach to a street; what's available (step 4c) is the Felt 2024 borough-level coverage (48 polygons → `cpz_area`), enough to flag a street as "in a Haringey CPZ — verify signage" (confidence 0.6, §6.5) vs. not. Per-zone polygons remain a data gap (FOI / web-map scrape). Run: `npm run ingest:haringey`.
   - **Tower Hamlets** ⚠️ (step 4b — hours; step 4c — borough-level coverage) — `sources/tower-hamlets.ts` reads `backend/static-data/tower-hamlets.json` (19 zones, all with hours; built by `npm run build:static-data:tower-hamlets` from the council parking-zones page + CPZ map PDF, hours hand-converted from prose to OSM syntax — cross-check `towerhamlets.traffweb.app`) → `cpz` rows with `geom` NULL. 16 mini-zones (A1–A6, B1–B4, C1–C4, D1–D2) plus 3 split-out sub-areas whose hours differ from the parent (A6 Brick Lane West, B3 Chrisp Street, C2 Trinity Square). Per-zone polygons same gap as Haringey; step 4c gives the Felt 2024 borough-level coverage (5 coarse polygons → `cpz_area`). Run: `npm run ingest:tower-hamlets`.
   - **Borough-level CPZ coverage** ✅ (step 4c) — `sources/cpz-areas.ts` + `static-data/<borough>-cpz-polygons.geojson` (fetched from the Felt 2024 London-CPZ map by `npm run fetch:felt-cpz`) → `cpz_area` (unlabelled polygons — borough only, no zone identity). Used for `polygon`-join boroughs where per-zone polygons aren't available: a street inside a `cpz_area` polygon ⇒ "in a CPZ here, hours-of-which unknown" ⇒ confidence 0.6 (UI can still show that borough's zone-hours spread as context); outside all of them ⇒ not in a CPZ. Run: `npm run ingest:cpz-areas`.
   - **Other boroughs** (Islington, Hackney, Newham, …) — named candidates only (§12); new adapter per borough as the app expands.
   - **No adapter / "neither world" borough** — still ingested for geometry if desired, but every zone there is confidence 0.4 with the borough-scoped warning (§4, §6.5). Never default-treated as all-free.
3. **OSM (Overpass)** — street geometry source for every committed borough. Also provides `parking:lane:*` lane geometry as a confidence signal where present, and `parking:*:zone=*` tags for the WF-style zone-code join.

### 6.2 Time-aware inclusion (evaluated at query time, not ingest time)

```
fn evaluate(zone, T) -> { eligible, confidence }:
  if zone.geom intersects any TfL Red Route:                  return { false, — }       # excluded

  # 1. zones with geometry + hours: Camden (cpz.geom) and WF (joined via osm_zone_tag)
  for each cpz matching zone (by geom or osm_zone_tag), with cpz.hours not null:
    if openingHoursMatch(cpz.hours, T):                       return { false, — }       # active CPZ ⇒ excluded
    # else this cpz is off at T — keep going (another overlapping cpz might be on)

  if zone has explicit OSM time-conditional restriction active at T:  return { false, — }  # excluded

  # 2. boroughs with only borough-level CPZ coverage (Haringey, Tower Hamlets):
  if zone is inside a cpz_area polygon for its borough:
    return { true, 0.6 }   # in a CPZ, which zone's hours apply is unknown — "verify with signage" (UI shows the borough's hours spread)

  # 3. nothing positively says otherwise:
  return { true, source-tier confidence }   # 1.0 Camden-covered / 0.8 WF JSON hit / 0.4 borough with no adapter at all
```

The default **flips** from the original brief: a street is **eligible at T unless something positively says otherwise**, rather than excluded unless OSM positively confirms free. This change is forced by OSM coverage realities (Camden has 2.3% positive tagging) and is safe because the authoritative restriction sources (TfL Red Routes + per-borough CPZs) cover the cases that actually matter.

`openingHoursMatch` uses the `opening_hours.js` library to parse OSM `opening_hours` syntax (e.g. `Mo-Fr 10:00-16:00`).

### 6.3 Common adapter schema

Every adapter writes to:

```sql
CREATE TABLE cpz (
  id              text primary key,                       -- e.g. 'camden:ca-n-camden-square' or 'waltham_forest:wse' (slug of source_zone_id)
  borough         text not null,
  source_zone_id  text not null,                          -- the borough's own id: 'CA-N Camden Square', 'WSE', etc.
  display_name    text,                                   -- human label, e.g. 'CA-N Camden Square', 'Wood Street East'
  geom            geometry(MultiPolygon,4326),            -- nullable when only OSM-tag-join is available
  hours           text,                                   -- OSM opening_hours syntax; null if uncatalogued
  source_type     text not null,                          -- 'camden_socrata' | 'waltham_forest_static' | ...
  last_synced_at  timestamptz not null
);
CREATE INDEX cpz_geom_gist ON cpz USING gist(geom) WHERE geom IS NOT NULL;
CREATE INDEX cpz_zone_id   ON cpz (borough, source_zone_id);
```

Where a source publishes finer-than-zone detail (currently only Camden's `7hiv-3r9k`), it also lands in a `cpz_bay` table — individual marked bays with their own `restriction_type`, raw `times_of_operation`, and `LineString` geometry. The time-aware query (§6.2) uses `cpz`; `cpz_bay` is captured for a later refinement (e.g. a stretch tagged "at any time" inside an otherwise-controlled zone). And where only *unlabelled* borough-level CPZ coverage is available (currently Haringey + Tower Hamlets, from the Felt 2024 map — they have hours-bearing `cpz` rows but no per-zone geometry), it lands in `cpz_area` — polygons tagged with the borough only, used to detect "in a CPZ here" without knowing which zone. Full DDL for all four tables (`cpz`, `cpz_bay`, `cpz_area`, `red_route`) in `backend/db/schema.sql`.

### 6.4 Zone unit (street segments)

A zone is a **LINESTRING** along contiguous OSM ways with **identical parking attributes**. Adjacent ways with the same `parking:lane:*`, `parking:condition:*`, and `parking:*:zone=*` are dissolved (`ST_LineMerge`) into one row. Geometry kept as linestring; rendered as a styled line on the client. `ST_ClosestPoint` works directly on linestrings.

```sql
CREATE TABLE zone (
  id              text primary key,                  -- stable hash of grouped OSM way ids
  geom            geometry(LineString,4326),
  street_name     text,
  parking_lane    text,                              -- 'parallel', 'diagonal', etc., or null
  osm_zone_tag    text,                              -- 'WSE', null
  source_way_ids  text[],
  last_synced_at  timestamptz not null
);
CREATE INDEX zone_geom_gist ON zone USING gist(geom);
CREATE INDEX zone_osm_zone  ON zone (osm_zone_tag) WHERE osm_zone_tag IS NOT NULL;
```

### 6.5 Confidence tiers

Confidence reflects data-source quality and personal experience, not OSM tag richness:

| Confidence | Condition |
|---|---|
| 1.0 | Zone covered by an authoritative API source (Camden `cpz` + hours) AND not flagged unknown |
| 0.8 | Zone joined to a static-JSON entry with known hours (WF: OSM zone tag → `cpz` hours) |
| 0.6 | "In a CPZ, but which?" — *either* a WF street tagged `parking:*:zone=*` with no JSON hours match, *or* a Haringey / Tower Hamlets street inside a borough-level `cpz_area` polygon (per-zone polygons not yet sourced). Surfaced as "verify with signage"; for the `cpz_area` case the UI also shows that borough's zone-hours spread as context |
| 0.4 | Street in a borough with **no CPZ adapter at all** — we don't even know whether a CPZ exists here; surfaced with the borough-scoped warning banner + hatched map tint (§4) |
| Excluded | Within an active CPZ at the user's arrival time, or on a TfL Red Route |

A street in a `polygon`-join borough that's *outside* all that borough's `cpz_area` polygons is treated as not in a CPZ — eligible at the borough's source tier (currently 0.8-ish: the Felt coverage is local-authority-sourced, but we accept it may miss the odd street). Confidence is weighted 0.3 (walk mode) / 0.2 (transit mode) in scoring (§5.1, §5.2), so a 0.4-tier street ranks below an otherwise-identical covered-borough street. **Personal log overrides everything** (§7). UI displays confidence as 3 / 2 / 1 dots (0.6 and 0.4 both render as 1 dot, distinguished by the warning text); no numeric value.

### 6.6 Resync schedule

| Source | Cadence | Mechanism |
|---|---|---|
| OSM (Overpass) | Weekly | Full refetch (all committed boroughs) into `zone_staging`, atomic swap |
| Camden Socrata | Weekly (data refreshed daily upstream) | `npm run ingest:camden` — pull `vf6e-iymu` → `cpz`, `7hiv-3r9k` → `cpz_bay` |
| Other API boroughs (per Step 0b) | Weekly | Same `socrata.ts` plumbing + per-borough module |
| Static-JSON boroughs (Waltham Forest, Haringey, Tower Hamlets) | Manual on edit | `npm run build:static-data` (regenerate from source rows) → `npm run ingest:wf|:haringey|:tower-hamlets`; re-verify quarterly against council pages |
| Felt CPZ-area polygons (Haringey, Tower Hamlets) → `cpz_area` | Annual (Felt map refreshed ~yearly) | `npm run fetch:felt-cpz` → `npm run ingest:cpz-areas` |
| TfL Red Routes | Quarterly (changes rarely) | Manual refresh |

---

## 7. Personal Log (replaces crowdsource for solo)

Stored locally on device via `expo-sqlite`, never synced.

```sql
CREATE TABLE search (
  id integer primary key autoincrement,
  searched_at datetime not null,
  destination_lat real, destination_lng real, destination_label text,
  mode text not null,                -- 'walk' | 'transit'
  time_mode text not null,           -- 'now' | 'arrive_by'
  arrival_time datetime,
  max_walk_minutes integer,
  include_bus integer,
  picked_zone_id text,
  raw_results_json text
);

CREATE TABLE outcome (
  zone_id text primary key,
  parked_count integer default 0,
  ticket_count integer default 0,
  last_outcome text,                 -- 'parked_ok' | 'ticketed' | 'sign_said_permit' | 'unsafe' | 'no_space' | 'verified_hours'
  last_outcome_at datetime,
  hours_observed text,               -- when outcome='verified_hours': OSM opening_hours syntax extracted from signage
  notes text
);
```

After parking, a quick "How did it go?" prompt logs an outcome. Outcomes override the data-source confidence:

```typescript
const displayConfidence = personalConfidence(zoneId) ?? sourceConfidence(zoneId);
// personal: parked_ok recently => 1.0, ticketed => 0 (excluded forever)
```

The `verified_hours` outcome is the bridge for zones where the static JSON has `null` hours — when the user reads a sign and types in the hours, the app can mark that zone resolved locally and contribute the data back to `waltham_forest_cpz_hours.json` via a developer-only sync action.

Over time the app becomes "places I have parked free before" — a much stronger signal than any external source.

---

## 8. Distribution & Dev Loop

- Apple ID with **Personal Team** signing (free).
- Local Xcode for builds. `xcodebuild -scheme ParkFree -destination 'platform=iOS,name=Daniels iPhone'` aliased for fast refresh.
- **7-day signing expiry** — calendar reminder Sunday evening, refresh before week starts.
- Wireless debug enabled to avoid USB ritual.
- No TestFlight, no App Store. App is "for me, on my phone."

---

## 9. Known Gotchas

- **OSM absence ≠ free, BUT CPZ overlap ≠ permanently restricted either.** The model is time-aware (§6.2). A street inside a CPZ is free outside that zone's operational hours.
- **Some London CPZs operate 7 days a week.** Examples include WF zone TU (Mo–Su 07:30–22:30). Don't assume "free on weekends" universally.
- **No consolidated London CPZ source exists.** TfL does not provide it; brief originally claimed otherwise (corrected). Each borough is a separate adapter. Camden API ✓; Waltham Forest static JSON (60/86 zones); Haringey + Tower Hamlets committed, adapter type TBD (Step 0b, §3b); Islington/Hackney/Newham named candidates only.
- **The "default to free" model is only safe where a CPZ adapter exists.** In a borough with OSM geometry but no adapter, every CPZ-controlled street would otherwise render as eligible/green — a PCN trap. Mitigated by the 0.4 confidence tier + borough-scoped warning banner + hatched map tint (§4, §6.5). Never ship an adapter-less borough at full confidence.
- **Waltham Forest has 26 zones with `null` hours.** Treated conservatively (excluded with "verify hours" prompt). User can resolve by entering hours after seeing signage; outcome flag `verified_hours` writes locally and can sync to repo.
- **TfL rate limit (500/hr free)** — irrelevant for solo, but still cache TfL responses server-side keyed by `(zonePoint rounded to 50m, destination rounded to 50m, time bucketed to 5min)`.
- **Use coordinates, never stop IDs** for TfL (Canary Wharf has two stations, etc.).
- **Always include `dlr` in TfL mode list** — east London coverage.
- **TfL disruptions** parsed and applied at scoring time (§5.4), not just shown.
- **Mapbox over `react-native-maps`** — better polygon/line rendering. Tile server still skipped — see §2.
- **expo-location permissions** — handle denial gracefully. App is fully functional without GPS.
- **Free Apple Team limits** — 10 unique App IDs lifetime, 3 active provisioned apps per device, 7-day profile expiry, no push, no associated domains.
- **Offline car parks** — persist React Query cache so last search survives signal loss.

---

## 10. MVP Build Order

| Step | Item | Status |
|---|---|---|
| 0 | OSM + CPZ coverage spike (§3) | **Done** — see `osm_spike/` |
| 0b | Borough recon spike (§3b) | **Done** — see `osm_spike/borough_recon.md` |
| 1 | Expo managed project + `react-navigation` scaffold + iOS-only config | **Done** — see `app/` (Expo SDK 52, expo-doctor clean, `npm run typecheck` clean) |
| 2 | Backend skeleton on Fly.io: Fastify + Supabase/Neon connection, health check | **Done** — see `backend/` (Fastify 5 + `pg`; `db:migrate`/`db:reset`/`db:status` scripts; `Dockerfile` + `fly.toml`; `npm test` covers `/`, `/health`, CORS, 404). **DB live on Supabase free tier** (Postgres 17.6 / PostGIS 3.3.7, Session pooler), schema applied, `GET /health` → `status:"ok"` |
| 3 | API-adapter plumbing `socrata.ts` + `sources/camden.ts` — `vf6e-iymu` → `cpz`, `7hiv-3r9k` → `cpz_bay` | **Done + ingested** — `cpz`: 50 Camden zones (all w/ hours + MultiPolygon geom); `cpz_bay`: 8,773 bays (mixed LineString/Polygon — column relaxed to `geometry(Geometry,4326)`). `npm test` green |
| 4 | Static-JSON adapter `static.ts` + `sources/waltham-forest.ts` + `sources/haringey.ts`; `backend/static-data/{waltham-forest,haringey}.json` built by `npm run build:static-data` | **Done + ingested** — `cpz`: WF 86 (60 hrs, OSM-tag join, `geom` NULL by design) + Haringey 45 (42 hrs, `geom` NULL until step 4c). `npm test` green |
| 4b | Tower Hamlets hours — `sources/tower-hamlets.ts` + `static-data/tower-hamlets.json` (19 zones: 16 mini-zones + 3 split-out sub-areas) built from the council parking-zones page + CPZ map PDF; hours hand-converted to OSM syntax (cross-check `towerhamlets.traffweb.app`) | **Done + ingested** — `cpz`: TH 19 (all w/ hours, `geom` NULL until step 4c). `npm test` green |
| 4c | CPZ-area coverage for Haringey + Tower Hamlets — `sources/cpz-areas.ts` + Felt 2024 polygons → `cpz_area` (borough-level, no zone identity). New `cpz_area` table; query semantics in §6.2/§6.5 ("in a CPZ here ⇒ 0.6 verify-signage"; outside ⇒ not in a CPZ) | **Partly done + ingested** — `cpz_area`: 53 polygons (Haringey 48, TH 5 coarse). `npm test` green. **Per-zone polygons for Haringey/TH still a data gap** — Felt carries no zone codes, no automatable council source; needs FOI / web-map scrape (→ then `cpz.geom`) |
| 5 | OSM zone ingestion — Overpass for all committed boroughs' residential ways (`*_residential.json` dumps already exist for Haringey/TH from Step 0b), `ST_LineMerge` grouping | **Next** |
| 6 | Backend `GET /zones?bbox=&t=` — viewport-clipped GeoJSON with time-aware inclusion (§6.2); per-zone confidence incl. 0.4-tier for adapter-less areas | |
| 7 | Search screen — Google Places autocomplete, mode toggle, time toggle, walk slider, bus toggle | |
| 8 | Map + Results screen with real zones rendered, **walk mode only** — incl. per-zone "verify with signage" badge, borough-scoped warning banner + hatched tint (§4) | |
| 9 | `ST_ClosestPoint` walk scoring + bottom-sheet ranked list (collapsed/mid/expanded) | |
| 10 | Backend TfL Journey integration + transit-mode scoring + disruption tiers | |
| 11 | Journey summary view inside expanded bottom sheet | |
| 12 | Google Maps / Apple Maps Navigate handoff | |
| 13 | Personal log: `expo-sqlite` schema + post-park prompt + `verified_hours` flow + `displayConfidence` override | |
| 14 | Polish: cold-start defaults, GPS-denial path, persistent React Query cache | |

---

## 11. Success Criteria

MVP is "validated" when **all** hold over a 1-month real-use period:

- **Comparative**: app finds parking faster or in better spots than current method (Streetview + memory) on **3 unfamiliar destinations**.
- **Outcome**: **5 total uses, zero PCNs.**
- **Coverage**: **at least one successful real use (parked, no PCN) in each committed borough beyond Camden** — i.e. ≥1 in Waltham Forest, ≥1 in Haringey, ≥1 in Tower Hamlets. Camden is exempt (reference implementation, holds the original known-free streets).

If all hit: hypothesis confirmed, decide whether to extend.
If the comparative/outcome criteria fail: diagnose — bad data (§6) or bad scoring (§5) or fundamental concept gap.
If a committed borough gets zero real uses in the window: that adapter was built prematurely — flag it for removal or deferral rather than carrying unvalidated integration cost.

The personal log (§7) is the validation instrument. Every search and outcome must be recorded; without the log there is no learning.

---

## 12. Out of Scope / Deferred

- **CarPlay-native UI** — requires paid Apple Developer Program + Apple entitlement approval. Apple Maps / Google Maps own CarPlay handling covers the drive leg.
- **Siri Shortcut "find parking near X"** — deferred. Reconsider after V1 validation.
- **Crowdsource reporting** — replaced by personal log for solo use.
- **Bus mode default-on** — opt-in toggle for now.
- **Android** — defer indefinitely.
- **TestFlight / App Store distribution** — requires paid Developer Program.
- **Parkopedia / paid commercial data** — too expensive pre-validation.
- **Outside the committed borough set** (Camden, Waltham Forest, Haringey, Tower Hamlets) — additional borough adapters required per §6.1. **Named next candidates: Islington, Hackney, Newham** — pulled in post-V1, or when a real trip forces one in (then it gets its own Step 0b-style mini-recon). Any borough may be shown geometry-only at the 0.4 confidence tier in the meantime (§6.5) if its data world is "neither".
- **Outside London / outside TfL coverage** — out of scope.

---

## 13. Competitive Context

The combination of free street parking + proximity to transit + journey planning to destination remains unserved by existing apps.

| App | Free street parking | Near transit | Transit routing | Notes |
|---|---|---|---|---|
| AppyParking+ | ✅ | ❌ | ❌ | 450+ UK towns |
| SpotAngels | ✅ | ❌ | ❌ | 200+ cities |
| Parknav | ✅ | ❌ | ❌ | Sensor + anon data |
| JustPark | ❌ (paid only) | ✅ | ❌ | Bookable only |
| **ParkFree** | ✅ | ✅ | ✅ | **Differentiator** |
