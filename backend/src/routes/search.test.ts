import '../testEnv'; // must precede the imports below — config.ts → db/pool.ts read DATABASE_URL at load time

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server';
import { pool } from '../db/pool';

after(async () => {
  await pool.end();
});

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = buildServer();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

// A plausible Camden-ish destination point with a 10-minute walk slider.
const OK_QS = 'lat=51.5421&lng=-0.1414&maxWalkMinutes=10';

test('GET /search/walk without query → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/search/walk' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /required/);
  }));

test('GET /search/walk with non-numeric coords → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/search/walk?lat=foo&lng=bar&maxWalkMinutes=10' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /must be numbers/);
  }));

test('GET /search/walk with out-of-range lat/lng → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/search/walk?lat=200&lng=-0.1&maxWalkMinutes=10' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /out of range/);
  }));

test('GET /search/walk with absurd maxWalkMinutes → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/search/walk?lat=51.54&lng=-0.14&maxWalkMinutes=300' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /maxWalkMinutes/);
  }));

test('GET /search/walk with a valid query but a bad t → 400 (before touching the DB)', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: `/search/walk?${OK_QS}&t=not-a-date` });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /^t must be/);
  }));

test('GET /search/walk with a valid query → 500 when the database is unreachable (the query layer is wired up)', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: `/search/walk?${OK_QS}` });
    assert.equal(res.statusCode, 500);
  }));
