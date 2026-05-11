-- ParkFree backend schema. Apply with:  psql "$DATABASE_URL" -f db/schema.sql
-- (Step 2 only ships connectivity + this DDL; the ingestion steps 3–5 populate it.)

create extension if not exists postgis;

-- --- CPZ adapters write here (brief §6.3) --------------------------------------
-- One row per controlled parking zone, from a per-borough adapter
-- (Camden Socrata API / Waltham Forest + Haringey + Tower Hamlets static JSON / …).
create table if not exists cpz (
  id              text primary key,                       -- e.g. 'camden:CA-N' or 'waltham_forest:WSE'
  borough         text not null,
  source_zone_id  text not null,                          -- 'CA-N', 'WSE', …
  display_name    text,
  geom            geometry(MultiPolygon, 4326),           -- nullable when only an OSM-tag join is available
  hours           text,                                   -- OSM opening_hours syntax; null if uncatalogued
  source_type     text not null,                          -- 'camden_socrata' | 'waltham_forest_static' | 'haringey_static' | 'tower_hamlets_static' | …
  last_synced_at  timestamptz not null default now()
);
create index if not exists cpz_geom_gist on cpz using gist (geom) where geom is not null;
create index if not exists cpz_zone_id   on cpz (borough, source_zone_id);

-- Per-bay detail (Camden's 7hiv-3r9k; possibly other API boroughs later). Finer-grained
-- than `cpz` — individual marked bays with their own restriction + hours + LineString.
-- Step 3 populates it; the time-aware query (step 6) primarily uses `cpz`, with per-bay
-- refinement (e.g. "this stretch is `at any time` even though the zone is controlled") a
-- documented later enhancement. `times_of_operation` is stored RAW and normalised on use.
create table if not exists cpz_bay (
  id                 text primary key,                        -- 'camden:<unique_identifier>'
  source             text not null,                           -- 'camden_socrata'
  borough            text not null,
  source_zone_code   text,                                    -- parent CPZ code, e.g. 'CA-B'
  road_name          text,
  restriction_type   text,                                    -- 'paid-for' | 'permit holders' | 'shared use' | 'no waiting' | …
  times_of_operation text,                                    -- RAW council string, e.g. 'mon-fri 08:30-18:30, sat 09:30-13:30' or 'at any time'
  geom               geometry(Geometry, 4326),                -- mixed: mostly LineString bays, some Polygon (shared-use) areas — stored as published
  last_synced_at     timestamptz not null default now()
);
create index if not exists cpz_bay_geom_gist on cpz_bay using gist (geom);
create index if not exists cpz_bay_zone      on cpz_bay (borough, source_zone_code);

-- --- OSM street segments (brief §6.4) ------------------------------------------
-- A zone = a LINESTRING along contiguous OSM ways with identical parking attributes,
-- dissolved via ST_LineMerge during ingestion (step 5).
create table if not exists zone (
  id              text primary key,                       -- stable hash of the grouped OSM way ids
  geom            geometry(LineString, 4326) not null,
  street_name     text,
  parking_lane    text,                                   -- 'parallel', 'diagonal', … or null
  osm_zone_tag    text,                                   -- 'WSE', null  (from parking:*:zone=*)
  source_way_ids  text[] not null,
  last_synced_at  timestamptz not null default now()
);
create index if not exists zone_geom_gist on zone using gist (geom);
create index if not exists zone_osm_zone  on zone (osm_zone_tag) where osm_zone_tag is not null;

-- --- Borough-level CPZ coverage polygons (build-order step 4c) -----------------
-- Unlabelled CPZ areas — polygons tagged only with the borough, no zone identity
-- (the Healthy Streets Scorecard / Felt "London CPZ by borough" map). Lets the
-- query distinguish "this street is in *a* CPZ in this borough" (which zone's hours
-- apply is unknown ⇒ confidence 0.6, "verify with signage") from "not in any CPZ
-- here" (eligible). Per-zone polygons — which would attach a specific `cpz` row's
-- hours to a street — remain a data gap for Haringey / Tower Hamlets (FOI / council
-- web-map scrape); when acquired they go in `cpz.geom`.
create table if not exists cpz_area (
  id              text primary key,                    -- 'felt_2024:haringey:0'
  borough         text not null,
  source_type     text not null,                       -- 'felt_2024'
  geom            geometry(MultiPolygon, 4326) not null,
  last_synced_at  timestamptz not null default now()
);
create index if not exists cpz_area_geom_gist on cpz_area using gist (geom);
create index if not exists cpz_area_borough    on cpz_area (borough);

-- --- TfL Red Routes (brief §6.1) ----------------------------------------------
-- Always-restricted roads (the TLRN). Refreshed manually, quarterly.
create table if not exists red_route (
  id              text primary key,
  geom            geometry(MultiLineString, 4326) not null,
  last_synced_at  timestamptz not null default now()
);
create index if not exists red_route_geom_gist on red_route using gist (geom);
