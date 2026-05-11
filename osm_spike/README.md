# Step 0 / 0b — OSM + CPZ Coverage Spikes — Artefacts

Outputs of the data-feasibility spikes for ParkFree. Step 0 run 2026-05-09 / 2026-05-10 (Camden + Waltham Forest). Step 0b run 2026-05-11 (the five candidate boroughs from decision D22 — Haringey, Tower Hamlets, Islington, Hackney, Newham).

## Files

| File | Purpose |
|---|---|
| `osm_spike_results.md` | Step 0 — OSM coverage analysis (Camden + Waltham Forest), found brief's data model fails; recommends time-aware pivot. |
| `cpz_data_sources.md` | Step 0 — survey of authoritative CPZ data sources across London. Camden has full API; Waltham Forest is PDF-only. |
| `waltham_forest_cpz_hours.json` | **Step 0 deliverable.** Per-zone JSON of WF CPZ codes → operational hours in OSM `opening_hours` syntax. 60/86 zones have hours, 26 still need manual sourcing. Production copy → `backend/ingestion/static-data/waltham-forest.json` when the WF adapter is built. |
| `borough_recon.md` | **Step 0b write-up.** OSM coverage + CPZ-source classification for the 5 candidate boroughs; ground-truth cross-check (Antill Rd N15, Sclater St E1); per-borough verdict. |
| `recon_fetch.sh` | Step 0b — Overpass fetch of `highway=residential` ways for the 5 candidate boroughs. |
| `recon_analyze.mjs` | Step 0b — classifier (`parking:*` / `parking:*:zone` density, zone-code collection, street cross-check). Produced `recon_analysis.json`. |
| `recon_analysis.json` | Step 0b — raw analysis output. |
| `{haringey,tower_hamlets,islington,hackney,newham}_residential.json` | Step 0b — Overpass dumps of residential ways per borough. |
| `analysis.json` | Step 0 — raw OSM coverage analysis. |
| `analyze.mjs` | Step 0 — script that produced `analysis.json`. |
| `extract_hours.py` | Step 0 — PDF text extraction pipeline (pdftotext + OCR fallback). |
| `consolidate.py` | Step 0 — merges all extraction sources into the WF JSON. |
| `discover_pdfs.sh` | Step 0 — URL probe for council PDFs. |
| `pdf_urls.txt` | Step 0 — output of probe — found 63 of 84 candidate zones. |
| `extracted_raw.json` | Step 0 — raw output of `extract_hours.py`. |
| `wf_pdfs/` | Step 0 — downloaded WF CPZ map PDFs (63 files) + `_ocr/` intermediate PNGs. **Git-ignored** (~107 MB); re-fetch with `discover_pdfs.sh` → `pdf_urls.txt`. The extracted data they produced (`waltham_forest_cpz_hours.json`, `extracted_raw.json`) is committed. |
| `camden_residential.json` | Step 0 — Overpass dump of Camden residential ways. |
| `waltham_forest_residential.json` | Step 0 — Overpass dump of WF residential ways. |

## Headline conclusions

1. **Brief's binary "in CPZ → exclude" inclusion rule is wrong.** The user drives on weekends; most CPZs aren't operational on weekends. The model needs **time-aware** inclusion. See `osm_spike_results.md` §4.
2. **There is no consolidated London-wide CPZ data source.** Camden has a structured Socrata API (polygons + per-bay hours, daily refresh). Waltham Forest publishes only PDF maps; hours must be hand-extracted. Other boroughs vary. Per-borough adapters needed. See `cpz_data_sources.md`.
3. **Waltham Forest manual extraction is feasible.** 60 of 86 OSM-tagged zones now have hours encoded in OSM `opening_hours` syntax in `waltham_forest_cpz_hours.json`. The pipeline (URL probe → curl → pdftotext + tesseract OCR + Claude vision fallback) recovered most. The 26 remaining zones either (a) have no PDF at standard URL patterns, or (b) have PDFs that show only the boundary map without hours text — they'll need manual sourcing as the user encounters them.
4. **All 5 of the user's known-free streets are now correctly handled** by the time-aware model:
   - Camden NW1 (Cantelowes, Rousden, St. Augustine's): zones CA-N / CA-G via Camden API. Free on Sundays as user reported.
   - Waltham Forest E17 (Fyfield, Winsbeach): zone WSE = Mo-Fr 10:00-16:00. Free Sat/Sun all day. Free Mon-Fri before 10am and after 4pm.

## Zones still missing hours (26 of 86)

26 zones have no hours catalogued. Most are low-traffic in OSM (≤30 ways each except MW). Strategy: leave as `null`, the app treats null as "unknown — exclude conservatively" and prompts the user to add hours via the personal log when they actually park there.

| Reason | Count | Zones |
|---|---|---|
| No PDF found at standard URL patterns | 21 | MW, HHN, BP, AM*, CML, CE, HE, ML, WXN, GGN, HPS, WD, SNW, LS, MC, LK, SR, RA, FGN, CG, H-TD, Jacks Farm RPZ |
| PDF exists but contains no hours text | 5 | HST, HT, MH, VA, WSC |

\* AM has hours from web search (Mo-Fr 08:00-18:30) but no PDF found.

**MW is the most-tagged zone in WF (93 OSM ways) — highest priority to source.** The "Market West" name suggests an area near Markhouse Road; manual lookup at the council planning office or street signage would resolve it.

## Step 0b headline (see `borough_recon.md` for detail)

- Committed boroughs after D22: **Camden, Waltham Forest, Haringey, Tower Hamlets**. Islington/Hackney/Newham are named candidates only.
- OSM `parking:*:zone=*` coverage among the 5 recon boroughs: Haringey 0.3%, **Tower Hamlets 0%**, Islington 0%, Hackney 0%, **Newham 58% (30 codes — WF-grade)**. The cheap tag-join exists for exactly one of them, and it's the one not committed.
- **Haringey — PROCEED.** Hours: parse `haringey.gov.uk/parking/cpzs/all-cpz-hours` (~45 zones) → `static-data/haringey.json`. Polygons: no open-data — sub-task (council web-map layer / 2018 FOI / Felt 2023). Geometry-only at the 0.4 confidence tier until polygons land.
- **Tower Hamlets — PROCEED, full adapter in MVP** (user's call). No structured hours source (Traffic Orders web app + prose; mini→4-parent-zone reorg in flux); no polygon open-data. Scrape Traffic Orders → `static-data/tower-hamlets.json` (step 4b); polygons sourced with Haringey's (step 4c). ~1–2 days; geometry-only at 0.4 is transitional until both land.
- **Newham** noted as the cheapest possible future addition (WF clone); not in scope.

## Next steps

Both spikes complete. Per the brief's §10 build order, the next code step is **Step 1 — Expo managed project + `react-navigation` scaffold + iOS-only config**. Then backend skeleton (2), Camden Socrata adapter (3), static-JSON adapter incl. `haringey.json` (4), Haringey polygon sub-task (4b), OSM zone ingestion for all committed boroughs (5).
