// Print what's loaded in the database: PostGIS version, row counts per table, and a
// breakdown of `cpz` by source_type.
//
//   npm run db:status        (dev, tsx)   |   node dist/db/status.js   (prod)

import { pool, checkDb } from './pool';

const TABLES = ['cpz', 'cpz_bay', 'cpz_area', 'zone', 'red_route', 'tfl_stop'] as const;

async function tableCount(name: string): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ n: string }>(`select count(*)::text as n from ${name}`);
    return Number(rows[0]?.n ?? '0');
  } catch {
    return null; // table doesn't exist yet (schema not migrated)
  }
}

export async function status(): Promise<void> {
  const db = await checkDb();
  console.log(`Postgres ${db.serverVersion ?? '?'} · PostGIS ${db.postgis ?? 'NOT ENABLED'}`);

  for (const t of TABLES) {
    const n = await tableCount(t);
    console.log(`  ${t.padEnd(10)} ${n === null ? '(missing — run db:migrate)' : n}`);
  }

  if ((await tableCount('cpz')) !== null) {
    const { rows } = await pool.query<{ source_type: string; n: string; with_hours: string; with_geom: string }>(
      `select source_type, count(*)::text as n,
              count(hours)::text as with_hours,
              count(geom)::text as with_geom
       from cpz group by source_type order by source_type`,
    );
    if (rows.length > 0) {
      console.log('  cpz by source_type:');
      for (const r of rows) {
        console.log(`    ${r.source_type.padEnd(22)} ${r.n} rows  (${r.with_hours} with hours, ${r.with_geom} with geom)`);
      }
    }
  }
}

if (require.main === module) {
  status()
    .then(() => pool.end())
    .catch((err: unknown) => {
      console.error('[db:status] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
