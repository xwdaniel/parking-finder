import type { FastifyInstance } from 'fastify';

import { pool } from '../db/pool';
import { cpzActiveAt } from '../zones/opening-hours';
import { evaluateZone, type CpzMatchActivity, type MatchedCpz } from '../zones/inclusion';

// Build-order step 6: GET /zones?bbox=&t= — every `zone` overlapping the map viewport,
// returned as a GeoJSON FeatureCollection with time-aware `eligible` + `confidence` +
// `reason` (brief §6.2 / §6.5). The RN client styles by confidence and (in walk/transit
// mode, steps 8–10) ranks the eligible ones. No tile server — the viewport is the bbox.

const DEFAULT_LIMIT = 10_000; // safety valve; a real phone viewport returns far fewer
const MAX_BBOX_SPAN_DEG = 0.5; // ~ a couple of boroughs — reject anything wildly larger than a map viewport

interface BboxOk {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function parseBbox(raw: string | undefined): BboxOk | { error: string } {
  if (!raw) return { error: 'bbox is required: ?bbox=minLon,minLat,maxLon,maxLat' };
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { error: 'bbox must be four comma-separated numbers: minLon,minLat,maxLon,maxLat' };
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return { error: 'bbox coordinates out of range' };
  if (minLon >= maxLon || minLat >= maxLat) return { error: 'bbox must have minLon < maxLon and minLat < maxLat' };
  if (maxLon - minLon > MAX_BBOX_SPAN_DEG || maxLat - minLat > MAX_BBOX_SPAN_DEG) {
    return { error: `bbox too large (max ${MAX_BBOX_SPAN_DEG}° per side) — zoom in` };
  }
  return { minLon, minLat, maxLon, maxLat };
}

function parseTime(raw: string | undefined): { date: Date } | { error: string } {
  if (!raw) return { date: new Date() }; // "leave now"
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `t must be an ISO 8601 datetime (got ${JSON.stringify(raw)})` };
  return { date: d };
}

interface ZoneRow {
  id: string;
  borough: string;
  street_name: string | null;
  parking_lane: string | null;
  parking_condition: string | null;
  osm_zone_tag: string | null;
  geojson: string; // ST_AsGeoJSON(geom, 6)
  on_red_route: boolean;
  in_cpz_area: boolean;
  matched_cpz: Array<{ source_zone_id: string; display_name: string | null; hours: string | null }> | null;
  borough_hours_spread: string[] | null;
}

// One round-trip: for every zone whose bounding box overlaps the viewport, gather
//  - its matched cpz rows (spatially where cpz.geom exists = Camden; by osm_zone_tag where it doesn't = WF),
//  - whether it sits inside a borough-level cpz_area coverage polygon (Haringey / TH),
//  - whether it touches a TfL Red Route (red_route currently empty → always false, cheap),
//  - the per-borough cpz-hours spread (context for the cpz_area "verify with signage" case).
const ZONES_SQL = `
with hours_spread as (
  select borough, array_agg(distinct hours order by hours) as hrs
  from cpz where hours is not null group by borough
)
select
  z.id, z.borough, z.street_name, z.parking_lane, z.parking_condition, z.osm_zone_tag,
  st_asgeojson(z.geom, 6) as geojson,
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
left join hours_spread hs on hs.borough = z.borough
where z.geom && st_makeenvelope($1, $2, $3, $4, 4326)
limit $5
`;

function activityOf(hours: string | null, at: Date): CpzMatchActivity {
  if (hours == null) return 'unknown';
  const on = cpzActiveAt(hours, at);
  if (on === null) return 'unknown'; // spec didn't parse — be honest, treat as "in a CPZ, hours unknown"
  return on ? 'active' : 'inactive';
}

export async function zoneRoutes(app: FastifyInstance): Promise<void> {
  // GET /zones?bbox=minLon,minLat,maxLon,maxLat&t=<ISO 8601 datetime>
  //   bbox — required; the map viewport, lon/lat in EPSG:4326.
  //   t    — optional intended arrival time; defaults to now. Interpreted as London
  //          wall-clock time (the server runs TZ=Europe/London — see config.ts), so a
  //          value with or without an explicit UTC offset both work.
  app.get('/zones', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const bbox = parseBbox(q.bbox);
    if ('error' in bbox) {
      reply.code(400);
      return { error: bbox.error };
    }

    const at = parseTime(q.t);
    if ('error' in at) {
      reply.code(400);
      return { error: at.error };
    }

    const { rows } = await pool.query<ZoneRow>(ZONES_SQL, [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, DEFAULT_LIMIT]);

    const features = rows.map((r) => {
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

      return {
        type: 'Feature' as const,
        geometry: JSON.parse(r.geojson) as unknown,
        properties: {
          id: r.id,
          borough: r.borough,
          streetName: r.street_name,
          parkingLane: r.parking_lane,
          parkingCondition: r.parking_condition,
          eligible: incl.eligible,
          confidence: incl.confidence,
          reason: incl.reason,
          zoneUnknown: incl.zoneUnknown,
          boroughHasAdapter: incl.boroughHasAdapter,
          hours: incl.appliedHours, // governing CPZ hours, when a single known one applies
          hoursSpread: incl.hoursSpread, // borough's CPZ-hours spread (in_cpz_area context)
          activeCpz: incl.activeCpz, // present only when excluded by an operational CPZ
          cpz: matchedCpz.map((c) => ({ zoneId: c.sourceZoneId, name: c.displayName, hours: c.hours })),
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
      meta: {
        t: at.date.toISOString(),
        bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
        count: features.length,
        truncated: features.length >= DEFAULT_LIMIT,
      },
    };
  });
}
