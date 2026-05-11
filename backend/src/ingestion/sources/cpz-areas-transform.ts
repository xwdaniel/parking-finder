// Pure transform for the borough-level CPZ-area adapter — no I/O, no DB. Unit-tested
// in cpz-areas-transform.test.ts; consumed by cpz-areas.ts which adds file loading +
// DB writes.

import type { CpzAreaRecord } from '../types';

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}
interface GeoJsonFeature {
  type?: string;
  geometry?: GeoJsonGeometry | null;
}
interface FeatureCollection {
  type?: string;
  features?: unknown[];
}

/** A GeoJSON FeatureCollection of (Multi)Polygons → CpzAreaRecord[] for one borough. */
export function featureCollectionToAreaRecords(
  raw: unknown,
  borough: string,
  sourceType: string,
): CpzAreaRecord[] {
  const fc = raw as FeatureCollection | null;
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error(`${borough}: expected a GeoJSON FeatureCollection`);
  }
  return fc.features.map((feat, i) => {
    const g = (feat as GeoJsonFeature)?.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) {
      throw new Error(`${borough}: feature ${i} is not a Polygon/MultiPolygon`);
    }
    return {
      id: `${sourceType}:${borough}:${i}`,
      borough,
      sourceType,
      geomGeoJson: JSON.stringify({ type: g.type, coordinates: g.coordinates }),
    };
  });
}
