# Step 0b — Borough Recon Spike

**Run:** 2026-05-11
**Scope:** the five candidate boroughs from D22 — Haringey + Tower Hamlets (committed), Islington / Hackney / Newham (named candidates).
**Goal:** classify each borough's CPZ data world before committing adapter work to the MVP build order. Same shape as Step 0.

Artefacts: `recon_fetch.sh`, `recon_analyze.mjs`, `recon_analysis.json`, `{borough}_residential.json` (Overpass dumps).

---

## 1. OSM coverage (`highway=residential` ways)

Baselines from Step 0: **Camden — 2.3% any `parking:*` tag, ~0% zone tags. Waltham Forest — 62.6% any, ~high zone tags, 86 distinct zone codes.**

| Borough | residential ways | any `parking:*` | **`parking:*:zone` (the join signal)** | distinct zone codes | positive lane geom | restrictive cond. |
|---|---:|---:|---:|---:|---:|---:|
| **Haringey** | 2,196 | 62 (2.8%) | **6 (0.3%)** | 3 (`HS`, `HG STA`, `TED`) | 46 (2.1%) | 11 (0.5%) |
| **Tower Hamlets** | 2,130 | 253 (11.9%) | **0 (0.0%)** | 0 | 171 (8.0%) | 1 (0.0%) |
| Islington | 1,619 | 46 (2.8%) | **0 (0.0%)** | 0 | 17 (1.1%) | 0 |
| Hackney | 2,027 | 293 (14.5%) | **0 (0.0%)** | 0 | 156 (7.7%) | 77 (3.8%) |
| **Newham** | 3,521 | 2,510 (71.3%) | **2,041 (58.0%)** | 30 (`B`, `CMH`, `CTN`, `CT`, `PR`, `L`, `PS`, `MO`, `RDE`, `GSN`, `RDW`, `U`, …) | 534 (15.2%) | 210 (6.0%) |

**Headline:** the OSM `parking:*:zone=*` tag-join — the cheap path that made Waltham Forest tractable — exists at usable density in **exactly one of these five boroughs: Newham (58%, 30 codes), which is WF-grade.** Both *committed* boroughs (Haringey, Tower Hamlets) have effectively **zero** OSM zone coverage; Tower Hamlets and Hackney do have decent *lane geometry* (~8%) but no zone codes. So for Haringey and Tower Hamlets there is **no street→CPZ join from OSM** — we need polygon geometry from elsewhere.

---

## 2. CPZ data sources

| Borough | Hours data | Polygon / boundary data | World | Effort |
|---|---|---|---|---|
| **Camden** (done) | Socrata API — per-zone + per-bay, daily refresh | Socrata API (GeoJSON) | **API** | done |
| **Waltham Forest** (done) | Council PDF maps — 60/86 zones extracted | none needed — OSM zone-tag join | **OSM-tag + manual-hours** | done |
| **Haringey** | ✅ **clean HTML table** at `haringey.gov.uk/parking/cpzs/all-cpz-hours` — ~45 zones, codes + names + hours, one parse | ❌ no open-data layer found. Council runs an interactive web map (clickable zones); a 2018 FOI request for CPZ shapefiles exists on WhatDoTheyKnow (outcome unverified); Felt 2023 has Haringey polygons (no hours, possibly stale) | **manual hours (easy) + polygons-TBD** | medium — hours ~1 hr; polygons need a sub-task |
| **Tower Hamlets** | ⚠ no structured source. Recently consolidated 16 mini-zones → 4 parent zones (A Bethnal Green / B Bow / C Shadwell-Stepney / D Poplar-Crossharbour); hours **vary per mini-zone** (mostly Mon–Fri 08:30–17:30, some Mon–Sat, a few with Sunday hours e.g. A1/A2 Sun 08:30–14:00). Lives in the Traffic Management Orders web app `towerhamlets.traffweb.app` + prose on the council site + a PDF zone map | ❌ no open-data layer. A 2014 INSPIRE WMS endpoint exists (`gis.towerhamlets.gov.uk` — rendering only, stale, pre-reorg); Felt 2023 polygons are pre-reorg too | **manual hours (hard, in flux) + polygons-TBD** | high — realistically 1–2 days, not 1–2 hours |
| Islington | not investigated in depth — Islington does run an open-data portal; CPZ hours are published per-zone on the council site | not confirmed | likely **manual or API** | deferred |
| Hackney | not investigated in depth | not confirmed | TBD | deferred |
| **Newham** | not investigated in depth — council publishes per-zone info; with 30 OSM zone codes the WF pipeline (URL-probe → pdftotext → OCR → consolidate) should apply almost directly | none needed — OSM zone-tag join | **OSM-tag + manual-hours (WF clone)** | low — ~half a day if ever wanted |

There is still no consolidated London-wide CPZ source. The cost of adding any borough is set by which bucket it falls in:
- **(a) has an API** — Camden. ≈ a per-borough `_socrata` field-mapping module.
- **(b) has OSM `parking:*:zone=*` tags** — Waltham Forest, Newham. ≈ one hours-extraction run; the join is free.
- **(c) neither** — Haringey, Tower Hamlets, Islington, Hackney. You must source polygon geometry yourself (FOI / scrape a council web map / Felt 2023 / hand-draw) *and* the hours. This is the expensive bucket — and it's where both committed boroughs sit.

---

## 3. Ground-truth cross-check

| Street | Borough | In OSM? | Parking tags | Verdict vs. "free at weekends" |
|---|---|---|---|---|
| **Antill Road, N15** | Haringey | Yes — multiple `highway=residential` ways | none | Consistent. N15 / South Tottenham CPZs are `ST South Tottenham` (Mon–Fri 10:00–12:00), `SA St Ann's` (Mon–Sat 08:00–18:30) or `7SS Seven Sisters South` (Mon–Fri 08:00–18:30) — all are weekend-free or Sunday-free. Can't pin the exact zone without polygons, but the hours regime in that area supports the claim. |
| **Sclater Street, E1** | Tower Hamlets | Not present as `highway=residential` (short market street off Brick Lane — likely `living_street`/`unclassified`/partly pedestrian) | n/a | Consistent but unverifiable from OSM. Sits in Zone A (Bethnal Green); Zone A hours are mostly Mon–Fri / Mon–Sat, and the Brick Lane **Sunday market** means bay suspensions along/near Sclater St — so "free at weekends" is plausible for reasons (market suspension) the model won't capture without TH's traffic-order data. |

Both checks come out *consistent with the user's claim* but *not independently confirmable from OSM alone* — which is itself the finding: in Haringey and Tower Hamlets, the OSM layer carries almost no parking signal, so eligibility there will rest entirely on the CPZ adapter (polygons + hours), which doesn't yet exist as open data.

---

## 4. Verdict

### Haringey — PROCEED
- **Hours:** parse `haringey.gov.uk/parking/cpzs/all-cpz-hours` into `backend/ingestion/static-data/haringey.json` (zone code → OSM `opening_hours` syntax). ~1 hr. Watch for: many Mon–**Sat** zones (not just Mon–Fri); a handful of Mon–**Sun** zones (Wood Green Inner 08:00–22:00, Muswell Hill 11:00–13:00, Tottenham Hale North, White Hart Lane, Tower Gardens); several **event-day** zones near Spurs stadium with variable hours — encode those conservatively or flag them.
- **Polygons:** open a small polygon-sourcing sub-task — try the Felt 2023 export and the council web map's backing layer first; FOI to Haringey (re-up the 2018 request) as fallback. Until polygons land, Haringey ships **geometry-only at the 0.4 tier** (§6.5 of brief).
- Once polygons + hours are both in: confidence **0.8** for matched zones (good hours, approximate boundaries).

### Tower Hamlets — PROCEED, full adapter in MVP scope (user's call, 2026-05-11)
- This is **not** a 1–2 hr job — realistically 1–2 days. Hours must be assembled from the Traffic Orders web app (`towerhamlets.traffweb.app`) + council prose into a per-mini-zone static JSON (`backend/ingestion/static-data/tower-hamlets.json`), and the mini→4-parent-zone reorg means the data is in flux. Polygons have the same problem as Haringey, worse (pre-reorg sources are stale) — sourced alongside Haringey's in build step 4c.
- I recommended shipping geometry-only-first with the full adapter as a post-MVP task; the user chose the full adapter inside MVP. Geometry-only at the 0.4 tier is therefore a *transitional* state (covers walk mode while hours+polygons are being assembled), not the end state. The cost is on the MVP critical path by choice.

### Islington, Hackney — stay deferred (§12), as planned. No change.

### Newham — note as the cheap option
- Newham has WF-grade OSM zone coverage (58%, 30 codes). If the committed set ever needs to grow or swap, Newham is by far the lowest-effort addition — the WF pipeline applies almost as-is. Worth remembering, but not in scope now.

### Cross-cutting
The committed set was chosen by trip frequency (correct — that's what the validation needs). But the **data-effort order is the reverse of intuition**: Newham (cheap, not committed) ≪ Haringey (easy hours, polygon sub-task) < Tower Hamlets (hard hours, polygon sub-task, structure in flux). The 0.4 geometry-only tier (D23) is the bridge: a borough is *useful for walk mode on day one* with just OSM geometry + a warning banner, then grows a real CPZ adapter. For Haringey and Tower Hamlets that 0.4 state is transitional — both get full adapters in MVP (steps 4–4c); the user explicitly chose to keep the Tower Hamlets data work on the critical path rather than defer it.
