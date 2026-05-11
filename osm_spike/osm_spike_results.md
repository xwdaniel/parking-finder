# Step 0 — OSM Coverage Spike Results

**Date:** 2026-05-09
**Boroughs sampled:** London Borough of Camden (relation 51827), London Borough of Waltham Forest (relation 65595)
**Source:** Overpass API — `way[highway=residential]` within each borough boundary

---

## Headline finding

**The brief's current data model fails the user's stated use case.** All 5 known-free streets the user supplied are flagged **NOT ELIGIBLE** under the brief's existing inclusion rules. Camden has near-zero OSM parking tagging (2.3% of residential ways). Waltham Forest is much better tagged (62.6%) but almost entirely via `parking:both:zone=WSE` — a CPZ zone reference that the brief rejects outright. The user drives on **weekends**, when those CPZs are typically not operational; the brief does not currently model time-conditional restrictions.

Decision: **PIVOT the data model** (see §4). Do not proceed with the brief as written.

---

## 1. Borough coverage stats

### Camden

| Metric | Count | % |
|---|---|---|
| Total residential ways | 1,682 | — |
| Any `parking:*` tag | 38 | **2.3%** |
| Positive lane geometry (`parking:lane=*` etc.) | 27 | 1.6% |
| Positive condition (`parking:condition=free` etc.) | 0 | 0.0% |
| Restrictive condition (`permit` / `residents` / etc.) | 0 | 0.0% |
| Time-interval / maxstay tags | 0 | 0.0% |
| **Eligible per brief rules** (positive, no restriction) | **27** | **1.6%** |
| Untagged | 1,644 | 97.7% |

### Waltham Forest

| Metric | Count | % |
|---|---|---|
| Total residential ways | 2,910 | — |
| Any `parking:*` tag | 1,821 | **62.6%** |
| Positive lane geometry | 204 | 7.0% |
| Positive condition | 0 | 0.0% |
| Restrictive condition | 13 | 0.4% |
| Time-interval / maxstay tags | 3 | 0.1% |
| **Eligible per brief rules** | **192** | **6.6%** |
| Untagged | 1,089 | 37.4% |

The dominant tag in Waltham Forest is `parking:both:zone=<ZONE_ID>` (mostly `WSE`). It marks the street as inside a controlled parking zone and references the zone identifier — but does not encode the zone's operational hours.

---

## 2. Cross-check: the user's 5 known-free streets

| Street | Borough | OSM segments | Parking tags found | Brief eligibility |
|---|---|---|---|---|
| Fyfield Road, E17 | Waltham Forest | 5 | `parking:both:zone=WSE` | NOT eligible |
| Winsbeach, E17 | Waltham Forest | 1 | `parking:both:zone=WSE` | NOT eligible |
| St. Augustine's Road, NW1 | Camden | 3 | none | NOT eligible |
| Cantelowes Road, NW1 | Camden | 5 | none | NOT eligible |
| Rousden Street, NW1 | Camden | 3 | none | NOT eligible |

**0 of 5 streets pass.** All three Camden streets are entirely untagged — the brief excludes them by default ("treat unmapped as unknown"). Both Waltham Forest streets are tagged with their CPZ zone, which the brief excludes ("not within any TfL CPZ polygon"). Yet the user has parked on all 5 free without trouble (on weekends).

The brief's binary "in CPZ → exclude" rule is **wrong** for the user's stated dominant use case. CPZs in London almost universally operate Mon–Fri, daytime, with free parking outside operational hours.

---

## 3. Decision per brief gates

The brief's gate (§3 of the brief):

| Coverage | Gate action |
|---|---|
| > 50% positive tags | Proceed as written |
| 20–50% | Augment with TfL CPZ as primary signal |
| < 20% | Pivot |

Numbers landing point:

- Camden: 1.6% eligible — well below 20% — gate says **pivot**
- Waltham Forest: 6.6% eligible per current rules — also below 20% — gate says **pivot**

**Both boroughs pivot.** But the gate decision tree itself was framed around the wrong question: "what % of streets does OSM positively confirm as free?" The right question, given how OSM and CPZs actually interact in London, is: **at a given time T, what % of streets are unrestricted?** That requires modelling time, which the brief does not.

---

## 4. Recommended data-model pivot

Replace the brief's current inclusion logic (Decision D1, §6.2 of brief) with a **time-aware, restriction-led** model. The change:

### 4.1 Sources, by priority

1. **TfL CPZ open data** (primary) — every borough publishes CPZ polygon data with operational hours. Westminster, Camden, Hackney etc. publish via London Datastore or own portals. Need to find one consolidated source or aggregate per-borough.
2. **TfL Red Routes** (primary) — always restricted, always exclude.
3. **OSM positive tags** (supplementary) — when present, they give lane geometry (helpful for UI rendering) and confidence boost. Absence is not informative.

### 4.2 Time-aware inclusion logic

```
Given destination_arrival_time T and zone Z:

  if Z intersects any TfL Red Route polygon:
    exclude (always restricted)

  for each CPZ polygon C overlapping Z:
    if T falls within C.operational_hours:
      exclude (permit-only at time T)

  if Z has OSM tag parking:condition:* in {permit, residents, ...}
        with no time_interval (i.e. always restrictive):
    exclude

  if Z has OSM tag parking:condition:*:time_interval covering T
        with restrictive value at T:
    exclude

  otherwise: include
```

Default assumption flips: a street is **eligible at time T unless something says otherwise**. This matches the user's reality — most London residential streets are free outside CPZ hours, and OSM coverage of street-level "free" tags is essentially nil.

### 4.3 Confidence model

Confidence is no longer about presence/absence of OSM positive tags (since both boroughs have ~0% positive condition tags). Re-tier:

| Confidence | Condition |
|---|---|
| 1.0 | TfL data confirms zone is outside any CPZ at time T AND not on a Red Route |
| 0.8 | Inside a CPZ, but T is outside operational hours per TfL data |
| 0.6 | OSM `parking:lane=*` present but no CPZ data — assume free, low confidence |
| Excluded | Any active restriction at time T |

The user's personal log (Decision D13) becomes even more important — it overrides this entire model with ground truth from real outcomes.

### 4.4 What this means for Step 0 next steps

- Sub-step 0a: locate authoritative TfL/borough CPZ polygon dataset with operational hours. Try London Datastore (`data.london.gov.uk`) and TfL Unified API first. If not consolidated, may need per-borough scraping.
- Sub-step 0b: re-run cross-check against TfL CPZ data. For each of the user's 5 known-free streets, confirm:
  - the street falls inside a CPZ polygon (expected)
  - the CPZ has operational hours metadata
  - Saturday/Sunday is outside those hours
- Sub-step 0c: if 0a/0b succeed, proceed to ingestion + revised inclusion rule. If 0a fails (no consolidated CPZ source), the project's data foundation is in trouble and the pivot may need to go further (manual zone entry as primary source).

---

## 5. Open questions to resolve before ingestion

- **What's the canonical source of London CPZ polygons + operational hours?** TfL Unified API has stop and journey data but is unclear on parking zones. Possible sources: London Datastore, individual borough open data portals, OS OpenMap, Ordnance Survey paid data.
- **CPZ operational hours are sometimes "Mon–Fri 8:30–18:30" but sometimes more complex** (different hours per zone, evening shifts, market-day variations). Schema must accommodate arbitrary opening rules. Reuse OpenStreetMap `opening_hours` syntax — already a parser ecosystem (`opening_hours.js`).
- **Some boroughs charge for parking at meters or pay-and-display even outside CPZ hours.** "Free" needs to be stronger than "not in CPZ at time T". Brief doesn't model paid parking yet — should it? For solo MVP, perhaps treat paid parking as ineligible (the user's mental model is "free street parking" = no money exchange).
- **OSM Camden untagged at 97.7% — is OSM ever going to be the primary source?** Probably not, even in dense inner London. Tagging effort doesn't scale.

---

## 6. Suggested updates to the brief and decisions

If we accept the pivot:

- **Decision D1 (positive evidence required)** — needs amendment. The principle "treat unknown as unknown, not free" still holds, but **TfL CPZ + operational hours becomes the unknown-resolver**, not OSM positive tags.
- **Decision D7 (OSM coverage spike)** — already executed. Outcome: pivot. Update entry with this result.
- **New decision D19 (time-aware inclusion)** — model restrictions as time-conditional rather than binary. Use OSM `opening_hours` syntax for CPZ operational hours.
- **Brief §6.2 inclusion rules** — rewrite per §4.2 above.
- **Brief §6.3 confidence tiers** — rewrite per §4.3 above.
- **Brief §1 search semantics** — already includes time toggle (D9). Now this becomes load-bearing for the inclusion logic, not just routing.

---

## 7. Raw artefacts

- `camden_residential.json` — Overpass dump, 1,682 ways
- `waltham_forest_residential.json` — Overpass dump, 2,910 ways
- `analyze.mjs` — analysis script
- `analysis.json` — structured output

Re-run with `node analyze.mjs` from this directory.
