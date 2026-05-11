// DROP the app tables and re-apply db/schema.sql. Dev convenience — wipes all
// ingested data. (Use `db:migrate` to apply the schema non-destructively.)
//
//   npm run db:reset

import { pool } from './pool';
import { migrate } from './migrate';

const TABLES = ['cpz', 'cpz_bay', 'cpz_area', 'zone', 'red_route'] as const;

export async function reset(): Promise<void> {
  await pool.query(`drop table if exists ${TABLES.join(', ')} cascade`);
  await migrate();
}

if (require.main === module) {
  reset()
    .then(() => console.log(`[db:reset] dropped ${TABLES.join(', ')} and re-applied schema.sql`))
    .then(() => pool.end())
    .catch((err: unknown) => {
      console.error('[db:reset] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
