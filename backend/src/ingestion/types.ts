// Common records every CPZ adapter produces. `geomGeoJson` carries stringified GeoJSON
// geometry objects (not Features); the DB layer turns them into PostGIS geometries.

export interface CpzRecord {
  id: string; // e.g. 'camden:ca-b-belsize'
  borough: string; // 'camden'
  sourceZoneId: string; // the borough's own zone identifier — 'CA-B Belsize', 'WSE', …
  displayName: string | null;
  /** GeoJSON Polygon strings to be unioned into one MultiPolygon; [] if no geometry available. */
  geomGeoJson: string[];
  /** OSM opening_hours syntax for the *restricted* window; null if uncatalogued. */
  hours: string | null;
  sourceType: string; // 'camden_socrata' | 'waltham_forest_static' | …
}

export interface CpzBayRecord {
  id: string; // e.g. 'camden:46133904'
  source: string; // 'camden_socrata'
  borough: string;
  sourceZoneCode: string | null; // parent CPZ code, e.g. 'CA-B'
  roadName: string | null;
  restrictionType: string | null; // 'paid-for' | 'permit holders' | 'shared use' | 'no waiting' | …
  /** RAW council string, e.g. 'mon-fri 08:30-18:30, sat 09:30-13:30' or 'at any time'. Normalised on consumption. */
  timesOfOperation: string | null;
  /** Stringified GeoJSON LineString or MultiLineString, or null. */
  geomGeoJson: string | null;
}
