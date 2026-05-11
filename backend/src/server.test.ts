import './testEnv'; // must precede the imports below — they read DATABASE_URL at load time

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

import { buildServer } from './server';
import { pool } from './db/pool';

after(async () => {
  // The pg Pool is a module singleton; close it so the test process exits cleanly.
  await pool.end();
});

/** Build a fresh server, run the assertions against it via `inject`, always close it. */
async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = buildServer();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

test('GET / returns the service banner', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { name: 'parkfree-backend', version: '0.1.0', ok: true });
  }));

test('GET /health reports the database as down when it is unreachable', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 503);
    const body = res.json() as { status: string; db: { connected: boolean }; error?: string; time: string };
    assert.equal(body.status, 'down');
    assert.equal(body.db.connected, false);
    assert.equal(typeof body.error, 'string');
    assert.equal(typeof body.time, 'string');
  }));

test('CORS: Access-Control-Allow-Origin reflects the request Origin', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { origin: 'http://localhost:8081' } });
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:8081');
  }));

test('an unknown route 404s', () =>
  withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    assert.equal(res.statusCode, 404);
  }));
