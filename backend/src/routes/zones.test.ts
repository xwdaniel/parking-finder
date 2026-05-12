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

// A plausible central-London viewport (bounded, well under MAX_BBOX_SPAN_DEG).
const OK_BBOX = 'bbox=-0.16,51.53,-0.14,51.55';

test('GET /zones without a bbox → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/zones' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /bbox/);
  }));

test('GET /zones with a malformed bbox → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/zones?bbox=foo,bar' });
    assert.equal(res.statusCode, 400);
  }));

test('GET /zones with a backwards bbox (min ≥ max) → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/zones?bbox=-0.1,51.5,-0.2,51.4' });
    assert.equal(res.statusCode, 400);
  }));

test('GET /zones with an absurdly large bbox → 400', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/zones?bbox=-2,50,2,53' });
    assert.equal(res.statusCode, 400);
  }));

test('GET /zones with a valid bbox but a bad t → 400 (before touching the DB)', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: `/zones?${OK_BBOX}&t=not-a-date` });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /^t must be/);
  }));

test('GET /zones with a valid bbox → 500 when the database is unreachable (the query layer is wired up)', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: `/zones?${OK_BBOX}` });
    assert.equal(res.statusCode, 500);
  }));
