import * as SQLite from 'expo-sqlite';

import { DATABASE_NAME, SCHEMA_SQL } from './schema';

// Lazy database singleton (brief §7). Opened on first read/write; subsequent calls
// reuse the same handle. The schema is applied idempotently with CREATE TABLE IF NOT EXISTS,
// so re-running migrate() is a no-op.

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync(SCHEMA_SQL);
      return db;
    })();
  }
  return dbPromise;
}

/** Test/debug helper — close the handle so the next getDb() reopens. Not used in normal app flow. */
export async function _resetDbForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) {
    const db = await p;
    await db.closeAsync();
  }
}
