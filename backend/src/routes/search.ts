import type { FastifyInstance } from 'fastify';

import { pool } from '../db/pool';
import { cpzActiveAt } from '../zones/opening-hours';
import { evaluateZone, type CpzMatchActivity, type MatchedCpz } from '../zones/inclusion';

// Build-order step 9: GET /search/walk — brief §5.1 walk-mode scoring. Returns the
// top 10 eligible zones within the user's slider radius of the destination, with
// walkPoint (`ST_ClosestPoint`), walkMinutes (`ST_Distance / 80`, brief §5), and a
// composite score (walkScore * 0.7 + confidence * 0.3, D5). Empty list ⇒ the UI
// surfaces "expand the slider" — never silently widen the radius (D3/D10).

const WALK_M_PER_MIN = 80;          // brief §5.1
const SCORE_WALK_WEIGHT = 0.7;      // brief §5.1 / D5
const SCORE_CONFIDENCE_WEIGHT = 0.3;
const MIN_WALK_MINUTES = 1;
const MAX_WALK_MINUTES = 60;        // slider is 2–30 (D3); allow a little headroom
const TOP_N = 10;                   // brief §5.1
const CANDIDATE_LIMIT = 500;        // safety cap before we slice top N — pre-filter

interface QueryOk {
  lat: number;
  lng: number;
  maxWalkMinutes: number;
}

function parseQuery(q: Record<string, string | undefined>): QueryOk | { error: string } {
  if (q.lat === undefined || q.lng === undefined || q.maxWalkMinutes === undefined) {
    return { error: 'lat, lng and maxWalkMinutes are required' };
  }
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  const maxWalkMinutes = Number(q.maxWalkMinutes);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(maxWalkMinutes)) {
    return { error: 'lat, lng and maxWalkMinutes must be numbers' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: 'lat/lng out of range' };
  if (maxWalkMinutes < MIN_WALK_MINUTES || maxWalkMinutes > MAX_WALK_MINUTES) {
    return { error: `maxWalkMinutes must be between ${MIN_WALK_MINUTES} and ${MAX_WALK_MINUTES}` };
  }
  return { lat, lng, maxWalkMinutes };
}

function parseTime(raw: string | undefined): { date: Date } | { error: string } {
  if (!raw) return { date: new Date() };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `t must be an ISO 8601 datetime (got ${JSON.stringify(raw)})` };
  return { date: d };
}

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
  matched_cpz: Array<{ source_zone_id: string; display_name: string | null; hours: string | null }> | null;
  borough_hours_spread: string[] | null;
}

// One round-trip per search. `geography` casts give true metres (rather than the
// degree-distance ST_Distance returns on geometry). The cross join + per-row
// ST_ClosestPoint is fine at single-user scale; if the radius grows, the prefilter
// is the ST_DWithin (uses the GiST index via the && expansion under the hood).
const SEARCH_SQL = `
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
  exists (
    select 1 from red_route r where r.geom && z.geom and st_intersects(r.geom, z.geom)
  ) as on_red_route,
  exists (
    select 1 from cpz_area a where a.borough = z.borough and a.geom && z.geom and st_intersects(a.geom, z.geom)
  ) as in_cpz_area,
  (
    select jsonb_agg(jsonb_build_object('source_zone_id', c.source_zone_id, 'display_name', c.display_name, 'hours', c.hours))
    from cpz c
    where c.borough = z.borough
      and (
        (c.geom is not null and c.geom && z.geom and st_intersects(c.geom, z.geom))
        or (c.geom is null and z.osm_zone_tag is not null and c.source_zone_id = z.osm_zone_tag)
      )
  ) as matched_cpz,
  hs.hrs as borough_hours_spread
from zone z
cross join dest d
left join hours_spread hs on hs.borough = z.borough
where st_dwithin(z.geom::geography, d.geom::geography, $3)
order by st_distance(z.geom::geography, d.geom::geography) asc
limit $4
`;

function activityOf(hours: string | null, at: Date): CpzMatchActivity {
  if (hours == null) return 'unknown';
  const on = cpzActiveAt(hours, at);
  if (on === null) return 'unknown';
  return on ? 'active' : 'inactive';
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // GET /search/walk?lat=&lng=&maxWalkMinutes=&t=
  //   Walk mode only — transit-mode (brief §5.2) is build-order step 10.
  app.get('/search/walk', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const parsed = parseQuery(q);
    if ('error' in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }

    const at = parseTime(q.t);
    if ('error' in at) {
      reply.code(400);
      return { error: at.error };
    }

    const radiusM = parsed.maxWalkMinutes * WALK_M_PER_MIN;
    const { rows } = await pool.query<WalkRow>(SEARCH_SQL, [parsed.lng, parsed.lat, radiusM, CANDIDATE_LIMIT]);

    const results = rows
      .map((r) => {
        const matchedCpz: MatchedCpz[] = (r.matched_cpz ?? []).map((c) => ({
          sourceZoneId: c.source_zone_id,
          displayName: c.display_name,
          hours: c.hours,
          activity: activityOf(c.hours, at.date),
        }));

        const incl = evaluateZone({
          borough: r.borough,
          osmZoneTag: r.osm_zone_tag,
          onRedRoute: r.on_red_route,
          matchedCpz,
          inCpzArea: r.in_cpz_area,
          boroughHoursSpread: r.borough_hours_spread ?? null,
        });

        const walkMinutes = r.walk_distance_m / WALK_M_PER_MIN;
        const walkScore = Math.max(0, 1 - walkMinutes / parsed.maxWalkMinutes);
        const score = walkScore * SCORE_WALK_WEIGHT + incl.confidence * SCORE_CONFIDENCE_WEIGHT;

        return {
          incl,
          row: r,
          matchedCpz,
          walkMinutes,
          walkScore,
          score,
        };
      })
      // Eligible only — excluded zones (red route / active CPZ) belong to /zones for the map, not the ranked list.
      .filter((x) => x.incl.eligible)
      // PostGIS guarantees walk_distance_m ≤ radiusM, but a confidence-0 outlier
      // would still rank below an eligible zone — be defensive about the score floor.
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N)
      .map((x) => ({
        zone: {
          type: 'Feature' as const,
          geometry: JSON.parse(x.row.geojson) as unknown,
          properties: {
            id: x.row.id,
            borough: x.row.borough,
            streetName: x.row.street_name,
            parkingLane: x.row.parking_lane,
            parkingCondition: x.row.parking_condition,
            eligible: x.incl.eligible,
            confidence: x.incl.confidence,
            reason: x.incl.reason,
            zoneUnknown: x.incl.zoneUnknown,
            boroughHasAdapter: x.incl.boroughHasAdapter,
            hours: x.incl.appliedHours,
            hoursSpread: x.incl.hoursSpread,
            activeCpz: x.incl.activeCpz,
            cpz: x.matchedCpz.map((c) => ({ zoneId: c.sourceZoneId, name: c.displayName, hours: c.hours })),
          },
        },
        walkPoint: { lat: x.row.closest_lat, lng: x.row.closest_lng },
        walkMinutes: x.walkMinutes,
        score: x.score,
      }));

    return {
      destination: { lat: parsed.lat, lng: parsed.lng },
      t: at.date.toISOString(),
      maxWalkMinutes: parsed.maxWalkMinutes,
      results,
      meta: {
        radiusMeters: radiusM,
        candidatesConsidered: rows.length,
        candidatesTruncated: rows.length >= CANDIDATE_LIMIT,
      },
    };
  });
}
