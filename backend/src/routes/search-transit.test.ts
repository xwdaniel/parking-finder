// Step 10 — GET /search/transit validation tests. The TFL_APP_KEY gate is the
// new bit; everything past it is shape parity with /search/walk.

import '../testEnv'; // must precede the imports below

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

const OK_QS = 'lat=51.5421&lng=-0.1414&maxWalkMinutes=10';

test('GET /search/transit without TFL_APP_KEY → 503 (transit needs a TfL key)', () =>
  withServer(async (app) => {
    const prev = process.env.TFL_APP_KEY;
    delete process.env.TFL_APP_KEY;
    try {
      const res = await app.inject({ method: 'GET', url: `/search/transit?${OK_QS}` });
      assert.equal(res.statusCode, 503);
      assert.match((res.json() as { error: string }).error, /TFL_APP_KEY/);
    } finally {
      if (prev !== undefined) process.env.TFL_APP_KEY = prev;
    }
  }));

test('GET /search/transit with TFL_APP_KEY but missing query → 400', () =>
  withServer(async (app) => {
    process.env.TFL_APP_KEY = 'test-key';
    try {
      const res = await app.inject({ method: 'GET', url: '/search/transit' });
      assert.equal(res.statusCode, 400);
      assert.match((res.json() as { error: string }).error, /lat/);
    } finally {
      delete process.env.TFL_APP_KEY;
    }
  }));

test('GET /search/transit with out-of-range lat/lng → 400', () =>
  withServer(async (app) => {
    process.env.TFL_APP_KEY = 'test-key';
    try {
      const res = await app.inject({ method: 'GET', url: '/search/transit?lat=200&lng=-0.1&maxWalkMinutes=10' });
      assert.equal(res.statusCode, 400);
      assert.match((res.json() as { error: string }).error, /out of range/);
    } finally {
      delete process.env.TFL_APP_KEY;
    }
  }));

test('GET /search/transit with bad maxWalkMinutes → 400', () =>
  withServer(async (app) => {
    process.env.TFL_APP_KEY = 'test-key';
    try {
      const res = await app.inject({ method: 'GET', url: '/search/transit?lat=51.54&lng=-0.14&maxWalkMinutes=999' });
      assert.equal(res.statusCode, 400);
      assert.match((res.json() as { error: string }).error, /maxWalkMinutes/);
    } finally {
      delete process.env.TFL_APP_KEY;
    }
  }));

test('GET /search/transit with valid query but bad t → 400 (before touching the DB)', () =>
  withServer(async (app) => {
    process.env.TFL_APP_KEY = 'test-key';
    try {
      const res = await app.inject({ method: 'GET', url: `/search/transit?${OK_QS}&t=not-a-date` });
      assert.equal(res.statusCode, 400);
      assert.match((res.json() as { error: string }).error, /^t must be/);
    } finally {
      delete process.env.TFL_APP_KEY;
    }
  }));

test('GET /search/transit with valid query → 500 when the database is unreachable (the query layer is wired up)', () =>
  withServer(async (app) => {
    process.env.TFL_APP_KEY = 'test-key';
    try {
      const res = await app.inject({ method: 'GET', url: `/search/transit?${OK_QS}` });
      assert.equal(res.statusCode, 500);
    } finally {
      delete process.env.TFL_APP_KEY;
    }
  }));
