import { Pool } from 'pg';

import { config } from '../config';

// Single shared connection pool. Small max — this is a solo-user backend and
// Supabase/Neon free tiers cap connections aggressively.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.pgSslDisabled ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Don't crash on idle-client errors (e.g. managed DB recycling connections).
  // eslint-disable-next-line no-console
  console.error('pg pool error', err);
});

export interface DbHealth {
  connected: boolean;
  postgis: string | null;
  serverVersion: string | null;
}

export async function checkDb(): Promise<DbHealth> {
  const { rows } = await pool.query<{ server_version: string; postgis: string | null }>(
    `select current_setting('server_version') as server_version,
            (select extversion from pg_extension where extname = 'postgis') as postgis`,
  );
  const row = rows[0];
  return {
    connected: true,
    postgis: row?.postgis ?? null,
    serverVersion: row?.server_version ?? null,
  };
}
