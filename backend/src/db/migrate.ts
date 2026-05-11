// Apply backend/db/schema.sql to the database in DATABASE_URL. Idempotent — the DDL
// is all `create … if not exists`, so it's safe to re-run.
//
//   npm run db:migrate        (dev, tsx)   |   node dist/db/migrate.js   (prod)
//
// On Supabase, if `create extension postgis` errors, enable PostGIS first via
// Dashboard → Database → Extensions → search "postgis" → enable, then re-run.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { pool } from './pool';

// src/db/migrate.ts → ../../db/schema.sql ; dist/db/migrate.js → ../../db/schema.sql
const SCHEMA_PATH = resolve(__dirname, '../../db/schema.sql');

export async function migrate(): Promise<void> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql); // multi-statement; node-postgres uses the simple query protocol here
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => console.log(`[db:migrate] applied ${SCHEMA_PATH}`))
    .then(() => pool.end())
    .catch((err: unknown) => {
      console.error('[db:migrate] FAILED:', err);
      void pool.end();
      process.exit(1);
    });
}
