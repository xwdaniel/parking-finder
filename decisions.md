# ParkFree — Decision Log

Why the brief looks the way it does. One entry per decision, in the order they were made during the design grilling on 2026-05-09.

Format: **What** changed, **Why** it changed, **Alternatives** considered, **Reconsider if** the assumption breaks.

---

## D1 — Free parking requires positive OSM evidence, not absence of restriction

**Original brief:** "Free street parking is identified by the absence of restrictions in OpenStreetMap, not a positive 'free parking' tag."

**Original decision:** Inverted. A street is only marked free if OSM has a positive tag AND it is not inside a CPZ polygon AND not on a Red Route. Anything else is "unknown" and excluded entirely.

**Why:** OSM coverage is patchy. "No tag" can mean "nobody mapped it" rather than "no restriction." Treating absence as free will produce false positives, which means tickets, which destroys trust.

**AMENDED 2026-05-10 (after Step 0 spike — D7):** the principle "treat unknown as unknown" still holds, but the *implementation* changed. The original "binary CPZ-overlap → exclude forever" rule rejected all five of the user's known-free streets because their CPZs are not operational on weekends. Replaced with the **time-aware** inclusion model in D19. The role of OSM positive tags also shifted: with Camden showing 2.3% positive coverage, OSM positive tags are no longer the primary admission criterion — authoritative CPZ hours data is. OSM tags now primarily provide street geometry and confidence boosts where lane geometry is mapped.

**Reconsider if:** Authoritative CPZ data becomes unreliable or stale, in which case the model must lean back on OSM positive evidence as a sanity check.

---

## D2 — Skip Parkopedia, augment OSM with TfL open data

**Original brief:** Did not mention Parkopedia.

**Decision:** Don't pursue Parkopedia for MVP. Instead augment OSM with TfL CPZ polygons + TfL Red Routes (free, official).

**Why:** Parkopedia is enterprise-only, no public pricing (likely £thousands/month), long sales cycle, and ToS forbid scraping. Pre-revenue solo project cannot license. TfL CPZ + Red Routes give authoritative restriction data for free.

**Reconsider if:** App validates and scales beyond solo use, and the coverage gap from OSM-only becomes the bottleneck.

---

## D3 — Walk distance is a user slider, not a fixed constant

**Original brief:** Park+Tube zone search radius hard-coded at 1.5km. Park-near mode unspecified.

**Decision:** Add a slider on the search screen, default 10 minutes (~800m). Slider is reused as max walk-to-destination (walk mode) and max walk-to-stop (transit mode).

**Why:** Walk tolerance varies hugely by user, weather, luggage. One number is wrong for everyone. Slider also makes the UX honest about the trade-off rather than hiding it.

**Alternatives:** Fixed radius (rejected — too rigid). Adaptive expansion (rejected — silent expansion erodes user trust; better to return empty + prompt).

---

## D4 — Bus mode is an opt-in toggle, off by default

**Original brief:** Inconsistent — §1 mentioned "Tube or bus stops" but §4 routing logic excluded bus from the TfL `mode` parameter.

**Decision:** Toggle on the search screen, off by default. When on, adds `bus` to TfL mode list.

**Why:** Bus journeys are slower, traffic-bound, and noisier in scoring. Default-on would clutter results in tube-dense areas. Default-off keeps results crisp; opt-in covers south London / non-tube areas where buses matter.

**Reconsider if:** Most real drives turn out to be in non-tube areas (south London, outer boroughs). Switch default to on.

---

## D5 — Confidence is a filter, not a weight

**Original brief:** Composite score `time*0.50 + confidence*0.35 + walk*0.15`. Low-confidence zones merely ranked lower.

**Decision:** Filter at `confidence >= 0.6`. Below the threshold, zones don't appear. Weights for surviving results: `time*0.40 + walk*0.40 + confidence*0.20` (transit mode), `walk*0.7 + confidence*0.3` (walk mode).

**Why:** With weighted-only confidence, a fast-but-illegal-parking zone can outrank a slow-but-legal one (timeScore swings 0.5 alone, easily outweighing the 0.35 confidence delta). Filtering ensures the app never recommends a zone it isn't reasonably sure about.

**Also:** Original weights (0.50/0.35/0.15) were undefended in the brief. Tuned during validation period.

**Reconsider if:** Filter is too aggressive (no results in many searches). Loosen threshold before reverting to weight-only.

---

## D6 — Routing uses ST_ClosestPoint, not centroid

**Original brief:** "Call TfL Journey Planner for each zone centroid."

**Decision:** For each (zone, target) pair, use `ST_ClosestPoint(zone.geom, target.geom)` to pick the routing point. Target = nearest TfL stop (transit mode) or destination (walk mode).

**Why:** Linear residential streets (typical London zone, 200–500m) have centroids that are nowhere near the nearest stop. Centroid routing systematically under-ranks long zones whose best point is at one end. `ST_ClosestPoint` is one PostGIS call, no extra TfL API hits.

---

## D7 — Step 0 OSM coverage spike is a hard gate

**Original brief:** OSM ingestion was step 5 of build order, after backend + UI work.

**Decision:** Insert Step 0: half-day OSM coverage spike on 2 boroughs the user actually drives to. Decide proceed / augment / pivot before any other code.

**Why:** With D1 (positive evidence required), OSM coverage is the project's biggest unknown. Discovering coverage is too sparse at step 5 means steps 1–4 were wasted. Derisk earliest.

**Decision gates:** >50% positive coverage → proceed; 20–50% → invert with TfL CPZ as primary; <20% → pivot to manual zone entry.

**Outcome (executed 2026-05-09 / 2026-05-10):**
- Camden: 2.3% any parking tag, 1.6% eligible per original rules
- Waltham Forest: 62.6% any parking tag (mostly `parking:both:zone=*` CPZ refs), 6.6% eligible per original rules
- All 5 of the user's known-free streets failed original rules
- "TfL CPZ open data" mentioned in original brief does not exist (TfL doesn't own CPZ data — boroughs do)
- Camden has a structured Socrata API; Waltham Forest is PDF-only

This forced two further decisions: D19 (time-aware inclusion model) and D20 (per-borough CPZ adapters). Step 0 served its purpose: significant data-model rework happened *before* any backend code was written.

Artefacts in `osm_spike/`: `osm_spike_results.md`, `cpz_data_sources.md`, `waltham_forest_cpz_hours.json` (60/86 zones), `README.md`.

---

## D8 — Expo managed workflow + iOS only

**Original brief:** Expo bare workflow, cross-platform iOS + Android.

**Decision:** Managed workflow with config plugins (`expo prebuild`). iOS only for V1.

**Why:** Bare workflow was historically required for Mapbox native linking, but `@rnmapbox/maps` now ships an Expo config plugin — managed works fine. Solo user has one phone (iOS); building Android costs ~40% extra dev time for zero validation benefit. Cross-platform later if validated.

**Reconsider if:** A second target user needs Android, or if validating against Android-specific behaviour matters.

---

## D9 — Time semantics: leave-now (default) and arrive-by toggle

**Original brief:** Always `timeIs=Arriving`.

**Decision:** Toggle on search screen. Leave-now is the default and uses `timeIs=Departing&time=now`. Arrive-by uses `timeIs=Arriving` with picker.

**Why:** Most real use is impromptu ("driving now, want parking near a stop, then transit"). Arrive-by mode plans backwards from a future time; if the user opens the app at 6:50pm for a 7pm arrival, the planner can return "should have left 20min ago" — looks broken. Leave-now matches the dominant intent.

**Reconsider if:** Real usage is mostly planned-ahead (the user said this is true more often than not — but defaulting to leave-now still costs nothing for planned trips since they explicitly toggle).

---

## D10 — Walk-mode and transit-mode have separate backend flows

**Original brief:** §4 only described transit routing. Walk mode unspecified.

**Decision:** Two distinct backend pipelines. Walk mode: PostGIS query + ST_ClosestPoint to destination + score with `walk*0.7 + confidence*0.3`, no TfL call. Transit mode: PostGIS query + nearest stops + parallel TfL calls + composite score with disruption tiering.

**Why:** Walk mode has no transit leg, so reusing the transit scoring formula adds noise from terms that are constant or absent. Two formulas keep each clean.

**Also:** Empty walk-mode results return empty + a "expand slider" prompt — never silently expand the radius.

---

## D11 — Zone unit is a LINESTRING grouped by contiguous parking rules

**Original brief:** Used "zone" everywhere without defining the unit. PostGIS schema implied polygons.

**Decision:** A zone is a `LINESTRING` along contiguous OSM ways with identical parking attributes (same `parking:lane:*` and `parking:condition:*`). Adjacent matching ways are dissolved (`ST_LineMerge`) into one row. Geometry stays as linestring; styled as a thick line at render time.

**Why:** Polygon zones for street parking are awkward (streets are linear, not areas). Per-OSM-way zones are too granular ("Hassett Road segment 3 of 7" is noise). Borough-level zones are useless. Contiguous-rule grouping produces zone counts in the right order of magnitude (~10–20k for inner London) and matches how a user thinks about a street ("Hassett Road, parallel parking, no restrictions"). `ST_ClosestPoint` works directly on linestrings.

---

## D12 — TfL disruption handling is three-tier and applied at scoring time

**Original brief:** "Disruptions should be checked and surfaced in the UI." Vague.

**Decision:** Three tiers, applied at backend scoring time (not just UI annotation):

1. Suspended / part-suspended affecting the chosen stop → **filter route entirely**
2. Severe delays → annotate red badge, multiply score by 0.7
3. Minor delays / future planned works → annotate yellow badge, no score change

**Why:** Letting a suspended-line zone rank #1 with a "suspended" badge is bad UX. Filter or demote at the source so ranking matches reality.

**Stale disruption** (disruption appears mid-trip) is accepted — solo user just refreshes.

---

## D13 — Confidence tiers (1.0 / 0.8 / 0.6) + personal log overrides everything

**Original brief:** Confidence "0–1 reflecting how complete the OSM data coverage is." Vague formula. Crowdsource report screen mentioned.

**Decision:** Confidence is a tiered enum:
- 1.0 explicit `parking:condition` ∈ {free, no_charge, yes}
- 0.8 `parking:lane=*` present, no condition tag
- 0.6 `amenity=parking` polygon only
- below 0.6 excluded (D1, D5)

Crowdsource is removed (sample size = 1, no value). Replaced by **personal log** in `expo-sqlite` storing every search + parking outcome. `displayConfidence = personalConfidence ?? osmConfidence`. After a few months, the personal log dominates — the app becomes "places I have parked free before."

**Why:** Concrete tiers are testable. Personal log scales with the actual user (one) rather than expecting traffic that won't come.

---

## D14 — Free Apple ID, local Xcode, accept 7-day refresh

**Original brief:** Did not address distribution.

**Decision:** Free Apple ID with Personal Team signing. Local Xcode for builds. Accept 7-day provisioning expiry; weekly refresh ritual via calendar reminder.

**Why:** £79/yr Developer Program would be worth it for a tool you must trust to be available on demand — but the user's stated worst-case is "fall back to my previous parking-finding methods." That fallback exists, so the unreliability isn't catastrophic. Free path acceptable.

**Trade-off acknowledged:** Mid-week expiry while away from Mac = app dead until home. Mostly OK for trips planned in advance.

**Reconsider if:** App becomes load-bearing for daily driving and the weekly refresh becomes painful, OR features needed (push, Live Activities, Siri intents in some forms) require the paid program.

---

## D15 — No CarPlay-native UI; rely on Google Maps / Apple Maps handoff

**Original brief:** CarPlay not mentioned.

**Decision:** ParkFree itself does not have a CarPlay app. Drive leg handled by handing off to Google Maps (preferred) or Apple Maps (fallback) via URL scheme. Both have their own CarPlay integration, so the route appears on the car screen automatically when the phone is connected.

**Why:** CarPlay-native UI requires (a) Apple Developer Program (rejected in D14), (b) an Apple-issued `com.apple.developer.carplay-parking` entitlement that pre-launch indie apps frequently don't get. Both blockers. Handoff covers the in-car experience adequately for a tool used once per drive.

**Reconsider if:** D14 reverses (paid program acquired) AND CarPlay entitlement can be obtained AND in-car UX becomes the differentiator.

---

## D16 — Hybrid map + bottom-sheet UX, hidden numeric score

**Original brief:** Separate "Map view" screen and "Zone detail bottom sheet" screen.

**Decision:** Single combined screen. Map shows all candidate zones colour-graded by rank. Bottom sheet has three snap points: collapsed (top 3 cards), mid (full ranked list), expanded (selected zone detail). Map ↔ list interactions are bidirectional. **Numeric scores are hidden** — communicate rank via list order + colour.

**Why:** Splitting map and detail across screens loses spatial context every time the user wants to compare. Hybrid is the industry-standard pattern (Citymapper, Google Maps) and worth copying. Hiding numeric scores prevents users from reverse-engineering the formula and over-trusting it.

---

## D17 — No tile server; REST GeoJSON; Supabase + Fly.io free tiers

**Original brief:** PostgreSQL + PostGIS + `pg_tileserv` (or Martin) for vector tiles. Hosting on Railway / Render / AWS.

**Decision:** Skip the tile server entirely. Backend exposes `GET /zones?bbox=` returning viewport-clipped GeoJSON. Hosting: Supabase (or Neon) for managed PG+PostGIS free tier; Fastify backend on Fly.io free tier.

**Why:** `pg_tileserv` is justified at scale because mobile bandwidth + render perf matter when many users pan many tiles. At single-user scale, viewport-clipped GeoJSON (~50–200KB per pan) renders fine in Mapbox and removes an entire piece of infrastructure. Fly.io free tier doesn't sleep (Render free does, ~30s cold start), better fit for a tool used impromptu.

**Reconsider if:** Pan latency becomes noticeable, or the app expands beyond solo use.

---

## D18 — Explicit MVP success criteria + log-or-no-learning

**Original brief:** No success criteria. Risk of building features endlessly.

**Decision:** MVP is "validated" when, over a 1-month real-use window, **both** hold:
- Comparative: app finds parking faster or in better spots than current method on **3 unfamiliar destinations**
- Outcome: **5 total uses, zero PCNs**

If both hit, hypothesis confirmed. If either fails, diagnose data (§6) or scoring (§5) before building more.

The personal log (D13) is the validation instrument — without it there is no evidence to learn from.

**Why:** Solo projects drift. A pre-committed exit criterion forces a real review point.

**AMENDED 2026-05-11 (after D22 borough expansion):** added a per-borough validation clause — over the validation month there must be **at least one successful real use (parked, no PCN) in each committed borough beyond Camden** (i.e. ≥1 in Waltham Forest, ≥1 in Haringey, ≥1 in Tower Hamlets). A committed borough that gets zero real uses in the window is a signal its adapter was built prematurely → flag for removal or deferral rather than carrying unvalidated integration cost. Camden is exempt (it is the reference implementation and holds the original known-free streets).

---

## D19 — Time-aware inclusion (forced by D7 spike outcomes)

**Trigger:** Step 0 spike (D7) showed every one of the user's 5 known-free streets failing the brief's binary CPZ-overlap exclusion rule, because the user drives on weekends when those CPZs aren't operational.

**Decision:** Replace binary "in CPZ → exclude" with time-aware: a street is eligible at time T unless TfL Red Routes overlap, OR a CPZ overlapping the street is operational at T, OR an OSM time-conditional restriction applies at T. Default flips: free unless something positively says otherwise.

**Why:** London CPZs operate per-zone schedules — most are Mon–Fri only, some include Saturday morning, some are 7-day. Outside those hours, parking is free. Without time-awareness, the app cannot recommend any street inside any CPZ, ever — which would exclude virtually all of inner London on weekends.

**How to apply:** Inclusion is evaluated at *query* time, not ingest time, because it depends on the user's intended arrival time. Use `opening_hours.js` to parse OSM `opening_hours` syntax (`Mo-Fr 10:00-16:00` etc.) for both the per-zone CPZ hours and any OSM `parking:condition:*:time_interval` tags.

**Reconsider if:** Per-zone hours data turns out to be unreliable or stale in practice (user logs `ticketed` outcomes inside zones the model said were free at that time). Mitigation already in place: personal log overrides the model (D13).

---

## D20 — Per-borough CPZ adapters; no consolidated London source exists

**Trigger:** D7 spike found that brief's "TfL CPZ open data" reference was wishful — TfL does not own or publish CPZ data; each London borough does. Coverage and format vary dramatically.

**Decision:** Adopt a pluggable per-borough adapter architecture in the backend, each adapter writing to a common `cpz` schema. Two adapter types so far:
- **API adapter** (Camden) — pulls Socrata API at `opendata.camden.gov.uk`, refreshed weekly. Datasets `vf6e-iymu` (zone polygons + hours) and `7hiv-3r9k` (per-bay detail).
- **Static-JSON adapter** (Waltham Forest) — reads `osm_spike/waltham_forest_cpz_hours.json` (60/86 zones hand-extracted from council PDFs). Joined to streets via OSM `parking:*:zone=*` tags rather than spatial intersection.

**Why:** No single source covers London CPZs. Camden has built a proper API; Waltham Forest hasn't and likely won't. Other boroughs vary. Forcing a single ingestion mechanism would either skip non-API boroughs entirely or pretend a uniformity that doesn't exist.

**How to apply:** When adding a new borough, identify its source type (API / portal / PDF-only), implement an adapter that emits the common `cpz` schema, and ensure OSM zone tags (or spatial intersection) join correctly.

**Reconsider if:** A canonical London-wide CPZ aggregator emerges (Felt has polygons but no hours; Healthy Streets Scorecard data is annual snapshot only). Until then, per-borough is the only honest model.

---

## D21 — Unknown CPZ hours surface as "verify with signage", not silent exclusion

**Trigger:** D7 spike output `waltham_forest_cpz_hours.json` has 26 zones with `null` hours (PDFs without hours text, or no PDF found). MW (93 OSM ways — most-tagged WF zone) is among them.

**Decision:** When a street is OSM-tagged with a CPZ zone code that the static JSON has no hours for, surface it in the UI with a "hours not catalogued — verify with signage" badge rather than silently exclude or default-include. Couple with a personal-log outcome flag `verified_hours` so the user can enter the hours they read off the sign, which (a) updates the local DB immediately for future searches, and (b) can be synced back to the repo's static JSON via a developer-only action.

**Why:** Silent exclusion punishes the user for a data gap they can fix in 30 seconds at a sign. Default-include risks false positives (PCN). Surfacing the gap turns the user's act of parking into a data-collection step that compounds value over time.

**How to apply:** Confidence tier 0.6 is reserved for this state in §6.5 of the brief. UI must visually distinguish 0.6 from 0.8/1.0. The personal log schema (§7) already has the `hours_observed` field for capturing user-entered hours.

**Reconsider if:** The user finds the "verify with signage" prompt annoying in practice. Options: lower the prompt frequency (e.g. only when zone is high-rank in results), or default-include uncatalogued zones with a softer warning. But never default-include without *some* warning.

---

## D22 — Committed borough set expands to four; a recon spike (Step 0b) gates it

**Trigger:** User's real trips span a north/east London band — most often Haringey, Waltham Forest and Tower Hamlets — so Camden + WF alone won't supply enough live test cases over the validation month. For this user, *coverage is part of the validation*, not a post-validation extension.

**Decision:** Expand the committed borough set from {Camden, Waltham Forest} to **{Camden, Waltham Forest, Haringey, Tower Hamlets}**. Islington, Hackney and Newham are recorded in §12 as *named candidate boroughs* with no committed adapter date — pulled in post-V1 or when a real trip forces the issue.

Before any of the 14 MVP build steps, run **Step 0b — borough recon spike** (same shape as Step 0 / D7):
- Overpass `parking:*:zone=*` tag-density count for all five new boroughs (the metric that told us Camden 2.3% / WF 62.6%).
- Classify each borough's CPZ source into one of three worlds: **API** (Socrata/CKAN/ArcGIS feed with zone polygons + operational hours, like Camden), **OSM-tag + manual-hours** (OSM has zone codes, hours live in council PDFs/web pages, like WF), or **neither** (no zone tags *and* no machine-readable hours → can't be done properly; drops to §12).
- Cross-check coverage against known-free streets: **Antill Road, N15 (Haringey)** and **Sclater Street, E1 (Tower Hamlets)** — both confirmed free on weekends by the user — plus a couple of spot-checks against council-published zone boundaries.
- Output: `osm_spike/borough_recon.md` (or similar). Its verdict rewrites the relevant build-order rows with concrete adapter types before code is written.

**Contingency if Haringey or Tower Hamlets is PDF-world:** Tower Hamlets (visited most) gets the one-off manual extraction as part of MVP build (the WF pipeline — URL probe → pdftotext → OCR → vision fallback → consolidate — already exists). Haringey (visited less) ships with `null` hours where uncatalogued and backfills via the personal-log `verified_hours` flow (D21). If either is "neither world", it drops out of the committed set back to §12.

**Why:** D1's cross-cutting principle says validate before paying complexity tax — but for *this* user the trips genuinely land in these boroughs, so a Camden-only validation wouldn't be representative. The gate (Step 0b) is the discipline that keeps this from being open-ended: a borough is only committed once its data world is known and sized.

**How to apply:** Step 0b is the immediate next action. Adapters slot in alongside the existing Camden (step 3) and WF (step 4) adapter steps; OSM ingestion (step 5) expands to all committed boroughs.

**Outcome (Step 0b executed 2026-05-11 — `osm_spike/borough_recon.md`):**
- OSM `parking:*:zone=*` coverage: Haringey 0.3% (3 codes), Tower Hamlets 0%, Islington 0%, Hackney 0%, **Newham 58% (30 codes — WF-grade)**. The cheap tag-join exists for *exactly one* of the five, and it's the one not committed.
- **Haringey** is "manual hours (easy) + polygons-TBD": hours come from one clean HTML table (`haringey.gov.uk/parking/cpzs/all-cpz-hours`, ~45 zones); polygons have no open-data source (sub-task: council web-map layer / 2018 FOI / Felt 2023). **Stays committed — PROCEED.** Ships geometry-only at the 0.4 tier (D23) until polygons land; then confidence 0.8 for matched zones.
- **Tower Hamlets** is "manual hours (hard, in flux) + polygons-TBD": 16 mini-zones recently consolidated into 4 parent zones, hours vary per mini-zone, data is in the Traffic Orders web app + council prose; no polygon open-data; pre-reorg sources are stale. Realistically 1–2 days of data work, not 1–2 hours. I recommended shipping TH geometry-only-first with the full adapter as a post-MVP task; **the user chose the full adapter in MVP scope (2026-05-11).** So: scrape Traffic Orders + prose → `tower-hamlets.json` (build step 4b), source polygons with Haringey's (step 4c); geometry-only at the 0.4 tier is only a transitional state until both land. The 1–2 day cost is now on the MVP critical path by choice.
- Islington/Hackney unchanged (deferred). Newham flagged as the cheapest future addition (WF clone) but not in scope.
- Ground-truth: Antill Road N15 and Sclater Street E1 both come out *consistent with* the user's "free at weekends" claim but *not independently confirmable from OSM* — which is the point: in these two boroughs OSM carries almost no parking signal, so the 0.4 geometry-only tier is load-bearing.

**Reconsider if:** The validation month shows zero real uses in a committed borough (per the D18 amendment) → that borough was premature; defer it. Or if the Haringey polygon sub-task (step 4b) proves unworkable → Haringey stays geometry-only at 0.4 indefinitely rather than dropping out.

---

## D23 — Adapter-less / partial-data boroughs are shown, not hidden — at a 0.4 confidence tier with a borough-scoped warning

**Trigger:** The "default to free" model (D19) is only *safe* where authoritative restriction sources (TfL Red Routes + the borough's CPZ adapter) cover the cases that matter. In a borough with OSM street geometry but **no CPZ adapter**, every CPZ-controlled street would render as eligible/green — a PCN trap. Same risk for parts of a borough with a *partial* adapter.

**Decision:** A borough is shown if it has OSM geometry, regardless of CPZ-adapter status — but coverage state is reflected in confidence and UI:
- New confidence tier **0.4 — "no CPZ adapter for this borough"** (1 dot + warning), distinct from and below 0.6 ("CPZ exists, hours uncatalogued"). Final ladder: **1.0 API → 0.8 static-JSON hit → 0.6 OSM zone tag, hours uncatalogued → 0.4 no adapter for this borough → Excluded** (Red Route or active CPZ at T). Confidence is weighted 0.3 (walk) / 0.2 (transit) in scoring, so 0.4-tier streets correctly rank below otherwise-identical covered-borough streets.
- A **borough-scoped warning banner** at the top of the results sheet whenever ≥1 result falls in an adapter-less borough: *"⚠ Limited data in {borough} — no parking-zone rules available. Check every sign."* (Distinct from the per-zone "verify with signage" badge, which is for the within-covered-borough uncatalogued case.)
- A **hatched-grey map tint** over adapter-less borough areas so the gap is visible before the user taps anything.

Rejected: hiding adapter-less boroughs entirely (clean but means a trip just outside the covered set returns "no results"); and showing them at full confidence (the PCN trap).

**Why:** A passive geometry-only tier costs little and means the app degrades gracefully at the edges of coverage instead of failing hard — provided the user is loudly told the data isn't there. The banner is the safety-critical element; the tint reinforces it.

**How to apply:** §6.5 of the brief carries the 0.4 row. The Map + Results screen (§4) carries the banner + tint. The geometry-only path also covers the fallback if Step 0b finds Haringey/TH are "neither world" — they can still be shown as 0.4-tier rather than dropped, if the user wants the geometry.

**Reconsider if:** The banner proves so frequent it's ignored (banner blindness) → consider gating it to high-rank results only, but never remove it entirely.

---

## D24 — Adapter architecture: shared transport plumbing + a thin per-borough module; production static data leaves the spike directory

**Trigger:** "The Camden adapter generalises" was only half-true (said during the D22 grilling, corrected here). Socrata is a *platform*; each borough's dataset has its own column names and shape. There is no single API adapter — there is shared plumbing plus per-borough field mapping.

**Decision:**
- **API boroughs:** shared `backend/ingestion/sources/_socrata.ts` (HTTP, pagination via `$limit`/`$offset`, SoQL `$where`) + a thin per-borough module (`camden.ts`, `haringey.ts`, …) mapping that borough's columns onto the common `cpz` schema (§6.3). Adding an API borough ≈ a few hours, mostly understanding their schema — not free.
- **Static-JSON boroughs:** shared `backend/ingestion/sources/_static.ts` loader + one JSON file per borough.
- **Production static data moves out of `osm_spike/`** to `backend/ingestion/static-data/{borough}.json` (e.g. `waltham-forest.json`, and `haringey.json` if it turns out PDF-world). The spike-directory copy stays as a historical artefact; the canonical one moves. `osm_spike/` is for one-off spike outputs, not data the running backend depends on.

**Why:** Naming the real shape now keeps future-me from expecting a free lunch when borough #5 lands, and keeps the spike directory from quietly becoming production infrastructure.

**How to apply:** When the WF adapter is built (step 4), it reads from `backend/ingestion/static-data/waltham-forest.json` — copy the spike JSON there as the first move. Step 0b's findings determine which new boroughs get a `_socrata` module vs a static JSON file.

**Reconsider if:** A non-Socrata API platform (CKAN, ArcGIS REST) shows up among the committed boroughs → add a sibling `_ckan.ts` / `_arcgis.ts` rather than bending `_socrata.ts`.

---

## D25 — `GET /zones`: pure inclusion function + a per-borough confidence policy; server pinned to Europe/London; the endpoint returns *all* viewport zones with flags, not just eligible ones (build-order step 6)

**Trigger:** Implementing the time-aware query (§6.2). Several small shape decisions had to be nailed down.

**Decision:**
- **Architecture split:** the §6.2 decision logic lives in a pure `src/zones/inclusion.ts` (`evaluateZone(snapshot) → { eligible, confidence, reason, … }`) — no DB, no clock, no `opening_hours` import — so the rules are unit-tested in isolation. The route (`src/routes/zones.ts`) does the PostGIS join + the `opening_hours` evaluation and hands a fully-resolved snapshot in. The `opening_hours.js` call sits behind `src/zones/opening-hours.ts` (`cpzActiveAt(spec, at) → true | false | null`, `null` = unparseable). Same `*-transform.ts`-style purity rule as the ingestion adapters.
- **Confidence as a per-borough policy** (mirrors §6.5's source tiers): Camden = `spatial_cpz`, base **1.0** (a Camden street outside every `cpz.geom` polygon is genuinely uncontrolled — the council map is authoritative); Waltham Forest = `tag_cpz`, base **0.8** (joins via `zone.osm_zone_tag = cpz.source_zone_id`); Haringey / Tower Hamlets = `area_cpz`, base **0.8** (only borough-level `cpz_area` coverage); any other borough = `none`, **0.4** (warning banner). The base tier is what an eligible zone gets when there's no *positive* in-CPZ evidence; positive evidence (a matched CPZ row whose hours we can't read, a WF zone carrying an OSM zone tag with no catalogued hours, or a Haringey/TH zone inside a `cpz_area` polygon) drops it to **0.6** with `zoneUnknown:true` ("verify with signage"). A matched CPZ that's *operational at T* → excluded; a matched CPZ that's *off at T* → eligible at the base tier with its hours surfaced as `appliedHours`. **An untagged Waltham Forest street → 0.8 (base tier), not 0.6** — the missing OSM zone tag is a data gap, not positive evidence of being in an unidentified CPZ.
- **Timezone:** `config.ts` (and `zones/opening-hours.ts`, belt-and-braces) sets `process.env.TZ ??= 'Europe/London'`; `fly.toml`/`.env.example` set `TZ` too. `opening_hours.getState()` reads local-time `Date` getters, so the server must run on London time for these CPZ specs to evaluate correctly. The `t` query param is therefore read as London wall-clock time (with or without an explicit offset) and defaults to "now".
- **`/zones` returns every zone whose bounding box overlaps the viewport bbox** — including the excluded ones, flagged `eligible:false` with `reason` (`red_route` / `active_cpz`) and an `activeCpz` field. The client styles by confidence and filters/ranks the eligible ones (steps 8–10). Rationale: this is the "what does the map look like at time T" endpoint; the ranked-results query (steps 9–10) is the one that filters. Geometry is **not** clipped to the bbox (zones returned whole — `ST_ClosestPoint` must work on the full geometry; "viewport-clipped" means *filtered to*, not *cut at*, the viewport), emitted at 6-decimal precision. Bbox is rejected if malformed, backwards, out of range, or larger than 0.5° per side; a `LIMIT 10000` safety valve with a `meta.truncated` flag.

**Why:** The pure/IO split keeps the safety-critical rules cheaply testable. A per-borough policy table makes the §6.5 ladder one readable place instead of scattered `if`s, and makes adding a borough a one-line edit. Pinning the timezone is the difference between "CPZ active at 13:00" being right and being an hour off — on a London-only app there's no downside. Returning all zones (not just eligible) means the map can show *why* a street is excluded right now, which is exactly the information the user is currently getting from Streetview + memory.

**How to apply:** Brief §10 step 6 = done. Step 7's Search screen builds the `t` value from the user's "arrive by" picker (local wall-clock ISO). Step 8 consumes the FeatureCollection, styling by `confidence` and rendering the `boroughHasAdapter:false` warning banner + hatched tint and the `zoneUnknown` "verify with signage" badge. Steps 9–10's ranked query reuses `evaluateZone` (filter to `eligible`, then score per §5).

**Reconsider if:** Viewport payloads get too big at borough-overview zoom → add server-side `ST_Simplify` and/or a `?simplify=` param, or clip geometry to bbox after all (accepting the `ST_ClosestPoint` caveat — recompute closest point client-side or in the ranked query). Or if the untagged-WF 0.8 proves over-confident in real use (a PCN on an untagged WF street) → drop untagged `tag_cpz` zones to 0.6, or source a WF `cpz_area` coverage layer.

---

## D26 — Destination input: Google Places autocomplete *when a key is configured*, Apple's on-device geocoder otherwise (build-order step 7)

**Trigger:** The brief names Google Places for destination autocomplete + geocoding (§2/§4), but a Google Places key needs a Google Cloud project with billing enabled — real setup friction for a solo MVP, and a hard blocker on the Search screen being testable until it's done.

**Decision:** `components/DestinationInput.tsx` checks `app.json` `extra.googlePlacesApiKey` (surfaced via `src/lib/env.ts`). **Key present** → `react-native-google-places-autocomplete` (`country:gb`, `fetchDetails`). **Key absent** (the default committed state — the field is `""`) → fall back to Apple's on-device geocoder via `expo-location` (`geocodeAsync` + `reverseGeocodeAsync` for tidy labels, debounced ~350 ms), with a small "using Apple Maps search — add a Google Places key for richer suggestions" hint. Both paths emit the same `PlaceSuggestion` `{ id, label, latitude, longitude }`; the rest of the screen and `SearchParams` don't care which was used.

**Why:** Keeps the screen fully functional and verifiable today with zero external-account setup, while honouring the brief's intent the moment a key is dropped in. Apple's geocoder is iOS-native, no key, and forward/reverse geocoding doesn't require the location permission (it's address↔coords translation, not device positioning) — so it's a clean, free baseline. The abstraction cost is one component with two branches.

**How to apply:** Step 7 = done. To enable Google: create a Google Cloud project, enable the "Places API" (legacy — that's what the lib v2 uses), create an API key, restrict it to iOS, and set `extra.googlePlacesApiKey` in `app.json` (or a gitignored local config). No code change needed. If the legacy Places API is ever sunset, swap the lib for a thin wrapper over Places API (New) — same `PlaceSuggestion` contract, so nothing downstream changes.

**Reconsider if:** Apple's geocoder proves too weak in real use (bad/missing matches on the destinations actually searched) → either commit to setting up a Google key, or add a third source (e.g. Nominatim) behind the same `searchPlaces*` interface.

---

## Cross-cutting principle

Many decisions trade scale-readiness for solo-readiness (D17 no tile server, D13 no crowdsource, D14 free Apple tier, D8 iOS only). This is intentional. Validate the **core hypothesis** — "the time-aware inclusion model + composite scoring beats my current parking-finding method" — before paying any complexity tax for users who don't exist yet. If the hypothesis fails, no amount of scale-readiness would save the project. If it succeeds, the scale-up decisions can be revisited with real evidence.

D22 (expanding to four committed boroughs) looks like a tension with this principle, but isn't: for *this* user the validation trips genuinely land across that north/east band, so a Camden-only validation would be unrepresentative — and the expansion is fenced by a hard gate (Step 0b) that refuses to commit a borough until its data world is known and sized. Coverage breadth that the validation actually exercises is part of the hypothesis test; coverage breadth for hypothetical future users is not, and stays in §12.
