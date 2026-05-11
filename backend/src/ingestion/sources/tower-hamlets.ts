// Tower Hamlets CPZ adapter (build-order step 4b — hours only; polygons + spatial
// join land in step 4c).
//
// Loads backend/static-data/tower-hamlets.json (built from the council's
// parking-zones page + CPZ map PDF by `npm run build:static-data:tower-hamlets`)
// and writes its zones to `cpz`. Like Haringey, Tower Hamlets publishes no
// machine-readable zone polygons, so `cpz.geom` is NULL and these rows match no
// street until polygons are sourced separately (step 4c then `UPDATE cpz SET geom = …`).
//
//   npm run ingest:tower-hamlets      (needs DATABASE_URL with the schema applied)

import { pool } from '../../db/pool';
import { ingestStaticBorough } from '../cpz-store';

export const TOWER_HAMLETS_STATIC_FILE = 'tower-hamlets.json';
export const ingestTowerHamlets = () => ingestStaticBorough(TOWER_HAMLETS_STATIC_FILE);

if (require.main === module) {
  ingestTowerHamlets()
    .then((r) => console.log('[tower-hamlets]', r))
    .then(() => pool.end())
    .then(() => console.log('[tower-hamlets] done'))
    .catch((err: unknown) => {
      console.error('[tower-hamlets] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
