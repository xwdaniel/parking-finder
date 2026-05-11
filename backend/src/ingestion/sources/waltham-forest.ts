// Waltham Forest CPZ adapter (build-order step 4).
//
// Loads backend/static-data/waltham-forest.json (built from the Step-0 spike by
// `npm run build:static-data:wf`) and writes its zones to `cpz`. WF has no zone
// polygons; streets join to these rows at query time via OSM `parking:*:zone=*`
// tags (`zone.osm_zone_tag = cpz.source_zone_id`), so `cpz.geom` is NULL here.
//
//   npm run ingest:wf      (needs DATABASE_URL with the schema applied)

import { pool } from '../../db/pool';
import { ingestStaticBorough } from '../cpz-store';

export const WF_STATIC_FILE = 'waltham-forest.json';
export const ingestWalthamForest = () => ingestStaticBorough(WF_STATIC_FILE);

if (require.main === module) {
  ingestWalthamForest()
    .then((r) => console.log('[waltham-forest]', r))
    .then(() => pool.end())
    .then(() => console.log('[waltham-forest] done'))
    .catch((err: unknown) => {
      console.error('[waltham-forest] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
