# CPZ Data Source Survey

**Date:** 2026-05-10
**Goal:** Find authoritative source(s) of London CPZ polygons + operational hours, to power the time-aware inclusion model recommended by the OSM spike.

---

## Headline finding

**There is no single consolidated London-wide source of CPZ polygons + operational hours.** Data quality varies dramatically by borough. Practical strategy: ingest per-borough, with a small typed adapter per source type.

Two relevant boroughs (Camden, Waltham Forest) sit at opposite ends of the spectrum:

- **Camden** — full structured open data API (polygons + hours + per-bay detail), updated daily. Solved.
- **Waltham Forest** — no open data, only per-zone PDF maps with hours embedded as title text. Manual extraction needed.

---

## 1. Camden — fully usable

**Portal:** `opendata.camden.gov.uk` (Socrata-based)

**Datasets verified:**

### CPZ polygons — dataset `vf6e-iymu`
- API: `https://opendata.camden.gov.uk/resource/vf6e-iymu.json`
- Fields: `controlled_parking_zone_code`, `controlled_parking_zone_name`, `sub_zone_name`, `control_monday_to_friday`, `control_saturday`, `location` (GeoJSON Polygon)
- Sunday hours implicit (no field) → effectively unrestricted by default
- Example: `CA-B Belsize` — Mon–Fri 09:00–18:30, Sat 09:30–13:30
- Last uploaded: 2026-05-09 (daily refresh)

### Per-bay parking detail — dataset `7hiv-3r9k`
- API: `https://opendata.camden.gov.uk/resource/7hiv-3r9k.json`
- Fields include: `restriction_type`, `times_of_operation`, `maximum_stay`, `tariff`, `road_name`, `controlled_parking_zone`, `valid_parking_permits`, full LineString geometries (EPSG:4326 + 27700)
- 24 distinct CPZ codes in Camden (CA-A through CA-Z roughly)
- Granularity: per individual parking bay — much richer than zone-level

### Verified against user's known-free streets
| Street | Zone | Hours | Sunday status |
|---|---|---|---|
| Cantelowes Road, NW1 | CA-N | Mon–Fri 08:30–18:30 | Free Sat (no Sat control listed for that bay), free Sun |
| Rousden Street, NW1 | CA-G | Mon–Fri 08:30–18:30, Sat 08:30–13:30 | Free Sun, free Sat afternoon |
| St. Augustine's Road, NW1 | (not yet queried) | — | — |

The bay-level operational hours dataset directly validates the user's "free on weekends" claim.

**Pagination:** Socrata default page size is 1000. Use `$limit` and `$offset` query parameters. `$where` for filtering. Standard SQL-like SoQL.

---

## 2. Waltham Forest — manual extraction required

**Portal:** none (no Socrata or equivalent)

**What exists:**
- Council CPZ landing page lists "core hours" but no machine-readable list
- Per-zone PDF maps published under `walthamforest.gov.uk/sites/default/files/` (e.g., `WSE - CPZ Map.pdf`) — these contain the operational hours as **plain text in the PDF title** ("WSE (Wood Street East) Controlled Parking Zone — Mon-Fri 10am to 4pm") plus the polygon as a drawn map (not extractable as data)
- Council Traffic Orders portal (`walthamforest.traffweb.app`) — possibly a richer source, not yet investigated
- A Freedom of Information request on WhatDoTheyKnow about WSN/WSE/WSS (not investigated)

**Verified zone hours:**
- WSE (Wood Street East): Mon–Fri 10am–4pm — confirmed by PDF read

**Other zones found in casual web searches (need full table eventually):**
- GM (Green Man): Mon–Fri 10:00–16:00
- KS (Kelmscott): Mon–Fri 08:00–18:30
- TU (Tudor Road): **Mon–Sun 07:30–22:30** — 7-day operation, no weekend free
- AM: Mon–Fri 08:00–18:30

**This is critical:** Waltham Forest hours are **highly variable** across zones, including some 7-day zones (like TU). Cannot assume "all CPZs are Mon–Fri." Each zone needs explicit hours.

**OSM has 84 distinct zone codes mapped on Waltham Forest residential ways**, e.g., `parking:both:zone=WSE`. This means OSM provides the zone-to-street join automatically. We just need a `WSE → "Mo-Fr 10:00-16:00"` lookup table.

**Practical extraction path:**
1. List all 84 zone codes from OSM data
2. For each, find the council PDF (`{ZONE} - CPZ Map.pdf` or `{ZONE} CPZ Map.pdf`)
3. Read PDF title text to extract operational hours (one-time effort, ~1–2 hours of work)
4. Encode as `MapboxGL`-compatible OSM `opening_hours` syntax (`Mo-Fr 10:00-16:00`)
5. Store as static JSON file in repo, joined to OSM zone tags at query time

---

## 3. Other London sources

### Felt London-wide CPZ map (not used)
- URL: `https://felt.com/map/London-Controlled-Parking-Zones-by-borough-map-6pDHqNl9CQQG3PuqgLsPO9BA`
- 1,297 polygons across 30+ boroughs as of 2023-03-31
- Created by William Petty (@microlambert), Healthy Streets Scorecard coalition
- **Polygons only — no operational hours.** Useless without hours.
- Last updated 2023, may be stale

### Other borough portals (spot-checked)
- Southwark: dataset on data.gov.uk
- Richmond: published `cpz_times` tool with USRN-based lookup
- Hammersmith & Fulham: web map only
- Bromley, Bexley, Hackney etc.: per-council pages, varied formats

### TfL Unified API
- **Does not include CPZ data.** TfL handles transit, not council parking.
- Confirms brief's mention of "TfL CPZ open data" was wishful — no such consolidated TfL endpoint exists.

### London Datastore
- Only parking-related dataset: "Coach Parking Locations" (TfL coach bays)
- **No CPZ dataset.**

---

## 4. Recommended ingestion strategy

### 4.1 Architecture: pluggable per-borough adapters

```
backend/
  ingestion/
    sources/
      camden.ts         // Socrata API client, polls daily
      waltham-forest.ts // reads static JSON of zone-code → hours
      _shared.ts         // common output schema
    static-data/
      waltham-forest-zones.json   // zone code -> { hours: "Mo-Fr 10:00-16:00", name }
    sync.ts            // orchestrates sources, writes to PG
```

Common output schema written to PostGIS:

```typescript
interface CpzZone {
  source: 'camden_api' | 'waltham_forest_manual' | ...;
  source_zone_id: string;       // e.g. 'CA-B' or 'WSE'
  borough: string;
  geom: GeoJSON.Polygon | null; // null if only zone-name + hours known
  hours: string;                // OSM opening_hours syntax: "Mo-Fr 09:00-18:30; Sa 09:30-13:30"
  display_name: string;
  last_synced_at: Date;
}
```

### 4.2 OSM zone tag join

For Waltham Forest (and other manual-only boroughs), the spatial join from "this street" to "this CPZ" comes for free via OSM tags:

```sql
SELECT z.id, z.geom, c.hours, c.display_name
FROM osm_zone z
LEFT JOIN cpz_static c
  ON c.source_zone_id = z.osm_zone_tag
WHERE ST_Intersects(z.geom, $bbox)
```

For Camden (and other API boroughs), use spatial intersection:

```sql
SELECT z.id, z.geom, c.hours, c.display_name
FROM osm_zone z
LEFT JOIN cpz_polygon c
  ON ST_Intersects(z.geom, c.geom)
WHERE ST_Intersects(z.geom, $bbox)
```

### 4.3 Time-aware inclusion query

Given user's intended arrival time T, parse `c.hours` (use `opening_hours.js` library — already exists, parses OSM `opening_hours` syntax):

```typescript
import OpeningHours from 'opening_hours';

function isFreeAt(hours: string | null, t: Date): boolean {
  if (!hours) return true; // no CPZ here
  const oh = new OpeningHours(hours);
  return !oh.getState(t);   // CPZ open => parking restricted
}
```

### 4.4 What this means for the brief

Updates needed:
1. **§2 External APIs** — replace "TfL Unified API — CPZ polygons" with: "Per-borough sources — Camden Socrata API; Waltham Forest manual JSON; ingestion strategy in §6". Note no consolidated TfL source.
2. **§5 Data Pipeline** — rewrite around the per-source adapter model, time-aware inclusion query.
3. **§6.2 Inclusion rules** — replace binary "not within any TfL CPZ polygon" with time-aware `isFreeAt(zone.hours, arrivalTime)`.
4. **§6.3 Confidence tiers** — re-tier around hours-source quality (Camden API → 1.0, manual JSON → 0.8, no source → 0.6 with prominent warning).
5. **New decision D19** — time-aware inclusion model.

---

## 5. Open risks

- **Manual JSON for Waltham Forest is brittle.** If the council changes hours, the static JSON is stale until manually updated. Mitigation: re-verify quarterly. For solo MVP, acceptable.
- **PDF parsing for non-Camden boroughs at scale doesn't work.** If app expands beyond Camden + Waltham Forest, every new borough needs a one-off integration. Pragmatic for MVP, doesn't scale.
- **OSM zone tags may be incomplete.** OSM has WF coverage at 62.6% — leaves 37.4% of streets without zone tags. Some of these are genuinely outside any CPZ; some are tagged-incompletely. Without polygon data for WF, no way to disambiguate. May need to fetch the Felt aggregated polygons (no hours) for at least the spatial coverage.
- **Some zones operate 7 days a week** (WF zone TU is a real example). Weekend driving assumption is per-zone, not blanket. The model handles this correctly via `opening_hours.js`, but the user's mental model of "free on weekends" needs to be tempered: it's not universally true.

---

## 6. Recommended next concrete step

Before writing any backend code:

1. **For Waltham Forest**: build the static JSON of zone codes → hours by reading the council PDFs. ~84 zones, ~1–2 hours of work. Output: `osm_spike/waltham_forest_cpz_hours.json`. This proves the manual extraction path is feasible and produces a deliverable artefact.
2. **For Camden**: confirm the Socrata API rate limits and pagination behaviour with a full pull. Verify the polygon and bay-level datasets join cleanly on `controlled_parking_zone`. Output: a small TypeScript ingestion script that pulls both, written to `backend/ingestion/sources/camden.ts` (one of the first real bits of project code).

If both succeed, the time-aware data model is grounded in real, working sources, and we can update the brief and decisions to reflect that. If WF manual extraction proves more painful than estimated, we may need to scope WF out of MVP and start with Camden only.
