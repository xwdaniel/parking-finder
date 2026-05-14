import type { FastifyInstance } from 'fastify';

import { config } from '../config';
import { pool } from '../db/pool';
import { cpzActiveAt } from '../zones/opening-hours';
import { evaluateZone, type CpzMatchActivity, type MatchedCpz, type ZoneInclusion } from '../zones/inclusion';
import { fetchJourneysParallel, type NormalJourney, TflMissingKeyError } from '../tfl/journey';
import { scoreMultiplier } from '../tfl/disruption';

// Build-order step 9 (walk) / step 10 (transit) — both ranked-search endpoints.
// /search/walk implements §5.1; /search/transit implements §5.2 with §5.4 disruption
// tiers and the in-memory TfL response cache from §9 (lives in src/tfl/journey.ts).

const WALK_M_PER_MIN = 80;                    // brief §5
const SCORE_WALK_WEIGHT = 0.7;                // brief §5.1 / D5
const SCORE_CONFIDENCE_WEIGHT = 0.3;
const TRANSIT_TIME_WEIGHT = 0.4;              // brief §5.2 / D5
const TRANSIT_WALK_WEIGHT = 0.4;
const TRANSIT_CONFIDENCE_WEIGHT = 0.2;
const TRANSIT_TOTAL_BUDGET_MIN = 45;          // brief §5.2: timeScore = max(0, 1 - totalMinutes / 45)
const MIN_WALK_MINUTES = 1;
const MAX_WALK_MINUTES = 60;
const TOP_N = 10;                             // brief §5.1 / §5.2
const WALK_CANDIDATE_LIMIT = 500;             // walk: safety cap before slicing top N
const TRANSIT_RADIUS_M = 1500;                // brief §5.2 step 1
const TRANSIT_CANDIDATE_ZONES = 25;           // bound TfL fan-out: closest-to-dest eligible zones (per zone × K=3 stops = ≤ 75 calls)
const TRANSIT_STOPS_PER_ZONE = 3;             // brief §5.2 step 3: K=3
const TRANSIT_CONCURRENCY = 6;                // TfL Unified API: 500/hr free tier — bounded parallelism

// --- shared helpers -----------------------------------------------------------

function parseFloatish(name: string, raw: string | undefined, range: [number, number] | null): { value: number } | { error: string } {
  if (raw === undefined) return { error: `${name} is required` };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { error: `${name} must be a number` };
  if (range && (v < range[0] || v > range[1])) return { error: `${name} out of range [${range[0]}, ${range[1]}]` };
  return { value: v };
}

function parseTime(raw: string | undefined): { date: Date } | { error: string } {
  if (!raw) return { date: new Date() };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `t must be an ISO 8601 datetime (got ${JSON.stringify(raw)})` };
  return { date: d };
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function activityOf(hours: string | null, at: Date): CpzMatchActivity {
  if (hours == null) return 'unknown';
  const on = cpzActiveAt(hours, at);
  if (on === null) return 'unknown';
  return on ? 'active' : 'inactive';
}

interface MatchedCpzRow {
  source_zone_id: string;
  display_name: string | null;
  hours: string | null;
}

function buildMatchedCpz(rows: MatchedCpzRow[] | null, at: Date): MatchedCpz[] {
  return (rows ?? []).map((c) => ({
    sourceZoneId: c.source_zone_id,
    displayName: c.display_name,
    hours: c.hours,
    activity: activityOf(c.hours, at),
  }));
}

function zonePropertiesFromIncl(args: {
  id: string;
  borough: string;
  streetName: string | null;
  parkingLane: string | null;
  parkingCondition: string | null;
  incl: ZoneInclusion;
  matchedCpz: MatchedCpz[];
}) {
  return {
    id: args.id,
    borough: args.borough,
    streetName: args.streetName,
    parkingLane: args.parkingLane,
    parkingCondition: args.parkingCondition,
    eligible: args.incl.eligible,
    confidence: args.incl.confidence,
    reason: args.incl.reason,
    zoneUnknown: args.incl.zoneUnknown,
    boroughHasAdapter: args.incl.boroughHasAdapter,
    hours: args.incl.appliedHours,
    hoursSpread: args.incl.hoursSpread,
    activeCpz: args.incl.activeCpz,
    cpz: args.matchedCpz.map((c) => ({ zoneId: c.sourceZoneId, name: c.displayName, hours: c.hours })),
  };
}

// =================================================================================
// GET /search/walk — brief §5.1 (build-order step 9)
// =================================================================================

interface WalkRow {
  id: string;
  borough: string;
  street_name: string | null;
  parking_lane: string | null;
  parking_condition: string | null;
  osm_zone_tag: string | null;
  geojson: string;
  closest_lng: number;
  closest_lat: number;
  walk_distance_m: number;
  on_red_route: boolean;
  in_cpz_area: boolean;
  matched_cpz: MatchedCpzRow[] | null;
  borough_hours_spread: string[] | null;
}

const WALK_SQL = `
with dest as (
  select st_setsrid(st_makepoint($1, $2), 4326) as geom
),
hours_spread as (
  select borough, array_agg(distinct hours order by hours) as hrs
  from cpz where hours is not null group by borough
)
select
  z.id, z.borough, z.street_name, z.parking_lane, z.parking_condition, z.osm_zone_tag,
  st_asgeojson(z.geom, 6) as geojson,
  st_x(st_closestpoint(z.geom, d.geom)) as closest_lng,
  st_y(st_closestpoint(z.geom, d.geom)) as closest_lat,
  st_distance(z.geom::geography, d.geom::geography) as walk_distance_m,
  exists (select 1 from red_route r where r.geom && z.geom and st_intersects(r.geom, z.geom)) as on_red_route,
  exists (select 1 from cpz_area a where a.borough = z.borough and a.geom && z.geom and st_intersects(a.geom, z.geom)) as in_cpz_area,
  (select jsonb_agg(jsonb_build_object('source_zone_id', c.source_zone_id, 'display_name', c.display_name, 'hours', c.hours))
   from cpz c
   where c.borough = z.borough
     and ((c.geom is not null and c.geom && z.geom and st_intersects(c.geom, z.geom))
       or (c.geom is null and z.osm_zone_tag is not null and c.source_zone_id = z.osm_zone_tag))
  ) as matched_cpz,
  hs.hrs as borough_hours_spread
from zone z
cross join dest d
left join hours_spread hs on hs.borough = z.borough
where st_dwithin(z.geom::geography, d.geom::geography, $3)
order by st_distance(z.geom::geography, d.geom::geography) asc
limit $4
`;

// =================================================================================
// GET /search/transit — brief §5.2 (build-order step 10)
// =================================================================================

interface TransitStopRow {
  stop_id: string;
  stop_name: string;
  stop_modes: string[];
  stop_lat: number;
  stop_lng: number;
  zone_pt_lat: number;
  zone_pt_lng: number;
  zone_to_stop_m: number;
}

interface TransitZoneRow {
  id: string;
  borough: string;
  street_name: string | null;
  parking_lane: string | null;
  parking_condition: string | null;
  osm_zone_tag: string | null;
  geojson: string;
  on_red_route: boolean;
  in_cpz_area: boolean;
  matched_cpz: MatchedCpzRow[] | null;
  borough_hours_spread: string[] | null;
  zone_to_dest_m: number;
  stops: TransitStopRow[];
}

// One round-trip:
//   1. zones within 1.5 km of destination (brief §5.2 step 1) + everything inclusion needs;
//   2. cross-lateral pick of K=3 nearest TfL stops per zone (the operator `<->` uses the
//      tfl_stop GiST index for KNN — cheap even with hundreds of stops);
//   3. group stops into a jsonb array on the zone row, ordered by distance.
const TRANSIT_SQL = `
with dest as (
  select st_setsrid(st_makepoint($1, $2), 4326) as geom
),
hours_spread as (
  select borough, array_agg(distinct hours order by hours) as hrs
  from cpz where hours is not null group by borough
),
candidates as (
  select z.id, z.borough, z.street_name, z.parking_lane, z.parking_condition, z.osm_zone_tag,
    st_asgeojson(z.geom, 6) as geojson, z.geom as zone_geom,
    exists (select 1 from red_route r where r.geom && z.geom and st_intersects(r.geom, z.geom)) as on_red_route,
    exists (select 1 from cpz_area a where a.borough = z.borough and a.geom && z.geom and st_intersects(a.geom, z.geom)) as in_cpz_area,
    (select jsonb_agg(jsonb_build_object('source_zone_id', c.source_zone_id, 'display_name', c.display_name, 'hours', c.hours))
     from cpz c
     where c.borough = z.borough
       and ((c.geom is not null and c.geom && z.geom and st_intersects(c.geom, z.geom))
         or (c.geom is null and z.osm_zone_tag is not null and c.source_zone_id = z.osm_zone_tag))
    ) as matched_cpz,
    hs.hrs as borough_hours_spread,
    st_distance(z.geom::geography, d.geom::geography) as zone_to_dest_m
  from zone z
  cross join dest d
  left join hours_spread hs on hs.borough = z.borough
  where st_dwithin(z.geom::geography, d.geom::geography, $3)
),
zone_stops as (
  select c.id as zone_id,
    s.id as stop_id, s.name as stop_name, s.modes as stop_modes,
    st_x(s.geom) as stop_lng, st_y(s.geom) as stop_lat,
    st_x(st_closestpoint(c.zone_geom, s.geom)) as zone_pt_lng,
    st_y(st_closestpoint(c.zone_geom, s.geom)) as zone_pt_lat,
    st_distance(c.zone_geom::geography, s.geom::geography) as zone_to_stop_m
  from candidates c
  cross join lateral (
    select id, name, modes, geom
    from tfl_stop
    order by tfl_stop.geom <-> c.zone_geom
    limit $4
  ) s
)
select c.id, c.borough, c.street_name, c.parking_lane, c.parking_condition, c.osm_zone_tag,
       c.geojson, c.on_red_route, c.in_cpz_area, c.matched_cpz, c.borough_hours_spread, c.zone_to_dest_m,
       jsonb_agg(jsonb_build_object(
         'stop_id', zs.stop_id, 'stop_name', zs.stop_name, 'stop_modes', zs.stop_modes,
         'stop_lat', zs.stop_lat, 'stop_lng', zs.stop_lng,
         'zone_pt_lat', zs.zone_pt_lat, 'zone_pt_lng', zs.zone_pt_lng,
         'zone_to_stop_m', zs.zone_to_stop_m
       ) order by zs.zone_to_stop_m) as stops
from candidates c
join zone_stops zs on zs.zone_id = c.id
group by c.id, c.borough, c.street_name, c.parking_lane, c.parking_condition, c.osm_zone_tag,
         c.geojson, c.on_red_route, c.in_cpz_area, c.matched_cpz, c.borough_hours_spread, c.zone_to_dest_m
order by c.zone_to_dest_m asc
`;

// =================================================================================
// route registration
// =================================================================================

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search/walk', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const lat = parseFloatish('lat', q.lat, [-90, 90]);
    if ('error' in lat) { reply.code(400); return { error: lat.error }; }
    const lng = parseFloatish('lng', q.lng, [-180, 180]);
    if ('error' in lng) { reply.code(400); return { error: lng.error }; }
    const maxWalkMinutes = parseFloatish('maxWalkMinutes', q.maxWalkMinutes, [MIN_WALK_MINUTES, MAX_WALK_MINUTES]);
    if ('error' in maxWalkMinutes) { reply.code(400); return { error: maxWalkMinutes.error }; }

    const at = parseTime(q.t);
    if ('error' in at) { reply.code(400); return { error: at.error }; }

    const radiusM = maxWalkMinutes.value * WALK_M_PER_MIN;
    const { rows } = await pool.query<WalkRow>(WALK_SQL, [lng.value, lat.value, radiusM, WALK_CANDIDATE_LIMIT]);

    const results = rows
      .map((r) => {
        const matchedCpz = buildMatchedCpz(r.matched_cpz, at.date);
        const incl = evaluateZone({
          borough: r.borough,
          osmZoneTag: r.osm_zone_tag,
          onRedRoute: r.on_red_route,
          matchedCpz,
          inCpzArea: r.in_cpz_area,
          boroughHoursSpread: r.borough_hours_spread ?? null,
        });
        const walkMinutes = r.walk_distance_m / WALK_M_PER_MIN;
        const walkScore = Math.max(0, 1 - walkMinutes / maxWalkMinutes.value);
        const score = walkScore * SCORE_WALK_WEIGHT + incl.confidence * SCORE_CONFIDENCE_WEIGHT;
        return { row: r, incl, matchedCpz, walkMinutes, score };
      })
      .filter((x) => x.incl.eligible)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N)
      .map((x) => ({
        zone: {
          type: 'Feature' as const,
          geometry: JSON.parse(x.row.geojson) as unknown,
          properties: zonePropertiesFromIncl({
            id: x.row.id,
            borough: x.row.borough,
            streetName: x.row.street_name,
            parkingLane: x.row.parking_lane,
            parkingCondition: x.row.parking_condition,
            incl: x.incl,
            matchedCpz: x.matchedCpz,
          }),
        },
        walkPoint: { lat: x.row.closest_lat, lng: x.row.closest_lng },
        walkMinutes: x.walkMinutes,
        score: x.score,
      }));

    return {
      destination: { lat: lat.value, lng: lng.value },
      t: at.date.toISOString(),
      maxWalkMinutes: maxWalkMinutes.value,
      results,
      meta: {
        radiusMeters: radiusM,
        candidatesConsidered: rows.length,
        candidatesTruncated: rows.length >= WALK_CANDIDATE_LIMIT,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // GET /search/transit?lat=&lng=&maxWalkMinutes=&t=&timeMode=&includeBus=
  //   maxWalkMinutes — slider value; serves as the walkScore denominator (§5.2 step 8)
  //   t              — arrival or departure time (default: now); CPZ evaluated at t
  //   timeMode       — 'now' (default) ⇒ TfL timeIs=Departing; 'arrive_by' ⇒ Arriving
  //   includeBus     — '1' / 'true' (default: false) adds 'bus' to the TfL mode list
  // ---------------------------------------------------------------------------
  app.get('/search/transit', async (req, reply) => {
    if (!config.tflAppKey) {
      reply.code(503);
      return { error: 'transit mode requires a TFL_APP_KEY — set one in backend/.env (see .env.example)' };
    }

    const q = req.query as Record<string, string | undefined>;
    const lat = parseFloatish('lat', q.lat, [-90, 90]);
    if ('error' in lat) { reply.code(400); return { error: lat.error }; }
    const lng = parseFloatish('lng', q.lng, [-180, 180]);
    if ('error' in lng) { reply.code(400); return { error: lng.error }; }
    const maxWalkMinutes = parseFloatish('maxWalkMinutes', q.maxWalkMinutes, [MIN_WALK_MINUTES, MAX_WALK_MINUTES]);
    if ('error' in maxWalkMinutes) { reply.code(400); return { error: maxWalkMinutes.error }; }
    const at = parseTime(q.t);
    if ('error' in at) { reply.code(400); return { error: at.error }; }
    const timeMode = q.timeMode === 'arrive_by' ? 'arrive_by' : 'now';
    const timeIs: 'Departing' | 'Arriving' = timeMode === 'arrive_by' ? 'Arriving' : 'Departing';
    const includeBus = parseBool(q.includeBus, false);

    const { rows } = await pool.query<TransitZoneRow>(TRANSIT_SQL, [lng.value, lat.value, TRANSIT_RADIUS_M, TRANSIT_STOPS_PER_ZONE]);

    // (1) eligibility — drop excluded zones before any TfL spend.
    const eligibleZones = rows
      .map((r) => {
        const matchedCpz = buildMatchedCpz(r.matched_cpz, at.date);
        const incl = evaluateZone({
          borough: r.borough,
          osmZoneTag: r.osm_zone_tag,
          onRedRoute: r.on_red_route,
          matchedCpz,
          inCpzArea: r.in_cpz_area,
          boroughHoursSpread: r.borough_hours_spread ?? null,
        });
        return { row: r, incl, matchedCpz };
      })
      .filter((x) => x.incl.eligible)
      .slice(0, TRANSIT_CANDIDATE_ZONES); // closest-to-dest first (SQL already ORDER BY zone_to_dest_m asc)

    // (2) flatten to (zone, stop) pairs — these are the TfL calls.
    interface Pair {
      zoneIdx: number;
      zone: typeof eligibleZones[number];
      stop: TransitStopRow;
    }
    const pairs: Pair[] = [];
    eligibleZones.forEach((z, zoneIdx) => {
      for (const stop of z.row.stops) pairs.push({ zoneIdx, zone: z, stop });
    });

    // (3) fan out TfL Journey calls — bounded concurrency, the small in-memory cache
    //     in src/tfl/journey.ts collapses repeat calls during a session.
    const journeyResults = await fetchJourneysParallel(
      pairs,
      (p) => ({
        from: { lat: p.stop.zone_pt_lat, lng: p.stop.zone_pt_lng },
        to: { lat: lat.value, lng: lng.value },
        timeIs,
        at: at.date,
        includeBus,
      }),
      TRANSIT_CONCURRENCY,
    );

    // (4) score, filter suspended journeys, keep one best (zone, stop) per zone.
    interface ScoredPair { pair: Pair; journey: NormalJourney; score: number }
    const bestPerZone = new Map<number, ScoredPair>();
    let networkErrors = 0;

    for (const r of journeyResults) {
      if (r.error) { networkErrors++; continue; }
      const j = r.journey;
      if (!j) continue; // TfL returned no journey for this pair
      if (j.disruption === 'suspended') continue; // brief §5.4 — filter the route entirely

      const conf = r.input.zone.incl.confidence;
      const timeScore = Math.max(0, 1 - j.totalMinutes / TRANSIT_TOTAL_BUDGET_MIN);
      const walkScore = Math.max(0, 1 - j.walkToStopMinutes / maxWalkMinutes.value);
      const rawScore = timeScore * TRANSIT_TIME_WEIGHT + walkScore * TRANSIT_WALK_WEIGHT + conf * TRANSIT_CONFIDENCE_WEIGHT;
      const score = rawScore * scoreMultiplier(j.disruption); // severe → ×0.7

      const candidate: ScoredPair = { pair: r.input, journey: j, score };
      const prev = bestPerZone.get(r.input.zoneIdx);
      if (!prev || candidate.score > prev.score) bestPerZone.set(r.input.zoneIdx, candidate);
    }

    // (5) sort + slice top 10 + shape response.
    const ranked = [...bestPerZone.values()].sort((a, b) => b.score - a.score).slice(0, TOP_N);
    const results = ranked.map((x) => {
      const z = x.pair.zone;
      const s = x.pair.stop;
      return {
        zone: {
          type: 'Feature' as const,
          geometry: JSON.parse(z.row.geojson) as unknown,
          properties: zonePropertiesFromIncl({
            id: z.row.id,
            borough: z.row.borough,
            streetName: z.row.street_name,
            parkingLane: z.row.parking_lane,
            parkingCondition: z.row.parking_condition,
            incl: z.incl,
            matchedCpz: z.matchedCpz,
          }),
        },
        zonePoint: { lat: s.zone_pt_lat, lng: s.zone_pt_lng },
        stop: { id: s.stop_id, name: s.stop_name, modes: s.stop_modes, lat: s.stop_lat, lng: s.stop_lng },
        walkToStopMinutes: x.journey.walkToStopMinutes,
        transitMinutes: x.journey.transitMinutes,
        totalMinutes: x.journey.totalMinutes,
        startDateTime: x.journey.startDateTime,
        arrivalDateTime: x.journey.arrivalDateTime,
        disruption: x.journey.disruption,
        legs: x.journey.legs,
        score: x.score,
      };
    });

    return {
      destination: { lat: lat.value, lng: lng.value },
      t: at.date.toISOString(),
      timeMode,
      includeBus,
      maxWalkMinutes: maxWalkMinutes.value,
      results,
      meta: {
        radiusMeters: TRANSIT_RADIUS_M,
        eligibleZones: eligibleZones.length,
        candidateZones: rows.length,
        tflCallsMade: pairs.length,
        tflNetworkErrors: networkErrors,
      },
    };
  });
}

// expose the missing-key error type so tests can map it without importing journey
export { TflMissingKeyError };
