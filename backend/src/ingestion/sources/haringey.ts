// Haringey CPZ adapter (build-order step 4 — hours only; polygons + spatial join
// land in step 4c).
//
// Loads backend/static-data/haringey.json (built from the council's all-cpz-hours
// page by `npm run build:static-data:haringey`) and writes its zones to `cpz`.
// Haringey publishes no machine-readable zone polygons, so `cpz.geom` is NULL and
// these rows do not match any street until polygons are sourced separately
// (step 4c then `UPDATE cpz SET geom = …`).
//
//   npm run ingest:haringey      (needs DATABASE_URL with the schema applied)

import { pool } from '../../db/pool';
import { ingestStaticBorough } from '../cpz-store';

export const HARINGEY_STATIC_FILE = 'haringey.json';
export const ingestHaringey = () => ingestStaticBorough(HARINGEY_STATIC_FILE);

if (require.main === module) {
  ingestHaringey()
    .then((r) => console.log('[haringey]', r))
    .then(() => pool.end())
    .then(() => console.log('[haringey] done'))
    .catch((err: unknown) => {
      console.error('[haringey] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
