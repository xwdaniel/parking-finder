# Static CPZ data (committed)

One JSON file per static-data borough — councils that don't publish a machine-readable
CPZ feed (cf. Camden, which has a Socrata API). Built by scripts under
`src/ingestion/scripts/`; **regenerate with `npm run build:static-data`**, don't hand-edit
(the source data lives in those scripts / the spike artefacts).

| File | Built from | `join` | Zones | Notes |
|---|---|---|---|---|
| `waltham-forest.json` | `osm_spike/waltham_forest_cpz_hours.json` (Step 0 PDF/OCR pipeline) — `build-wf-static.ts` | `osm_zone_tag` | 86 (60 with hours) | streets link via OSM `parking:*:zone=*` tags; the 26 null-hour zones resolve incrementally via the personal-log `verified_hours` flow (brief §7) |
| `haringey.json` | `haringey.gov.uk/parking/cpzs/all-cpz-hours` (raw rows in `build-haringey-static.ts`) | `polygon` | 45 (42 with hours) | **hours only** — no machine-readable polygons; the street→zone join needs polygons sourced separately (build-order step 4c) before these rows match anything; 3 event-only zones have null hours |
| `tower-hamlets.json` | council parking-zones page + CPZ map PDF (hand-converted rows in `build-tower-hamlets-static.ts`) | `polygon` | 19 (all with hours) | **hours only** — same as Haringey, polygons in step 4c. 16 mini-zones (A1–A6, B1–B4, C1–C4, D1–D2) + 3 split-out sub-areas (A6 Brick Lane West, B3 Chrisp Street, C2 Trinity Square); cross-check against `towerhamlets.traffweb.app` |

Shape (validated by `parseStaticDataFile` in `src/ingestion/static.ts`):

```jsonc
{
  "borough": "haringey",                       // → cpz.borough, cpz.id prefix
  "displayBorough": "London Borough of Haringey",
  "join": "osm_zone_tag" | "polygon",          // how streets link to these zones
  "sourceType": "haringey_static",             // → cpz.source_type
  "generatedAt": "2026-05-11",
  "source": "…where the data came from…",
  "zones": [
    { "code": "ST", "name": "South Tottenham", "hours": "Mo-Fr 10:00-12:00", "note": null, "provenance": "haringey council all-cpz-hours page" }
  ]
}
```

`hours` is OSM `opening_hours` syntax for the *restricted* window (null = uncatalogued).
The adapter (`sources/<borough>.ts`) loads the file and writes `cpz` rows with `geom = NULL`.

## CPZ-area polygons (step 4c) — `*-cpz-polygons.geojson`

`haringey-cpz-polygons.geojson` (48 polygons), `tower-hamlets-cpz-polygons.geojson` (5 polygons) —
fetched from the Felt "London CPZ by borough — 2024" map by `npm run fetch:felt-cpz`. **Borough-level
coverage only**: each polygon is tagged with the borough, not a zone code, so they answer "is this
street inside *a* CPZ here?" but not *which* zone's hours apply. `sources/cpz-areas.ts` loads them
into `cpz_area`; the query (step 6) treats a street inside one as confidence 0.6 ("verify with
signage") and a street outside all of them as not-in-a-CPZ. Per-zone polygons — which would attach
a specific `cpz` row's hours via `cpz.geom` — remain a data gap for Haringey / Tower Hamlets (FOI /
council web-map scrape; no automatable source found). Tower Hamlets' Felt coverage is coarse (5
dissolved areas).
