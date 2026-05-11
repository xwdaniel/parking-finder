import type { FastifyInstance } from 'fastify';

import { checkDb } from '../db/pool';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness + DB connectivity. Used by Fly.io's HTTP health check (see fly.toml).
  app.get('/health', async (_req, reply) => {
    const time = new Date().toISOString();
    try {
      const db = await checkDb();
      if (!db.postgis) {
        // Connected but PostGIS not enabled — the data pipeline can't run yet.
        reply.code(503);
        return { status: 'degraded', time, db, hint: "run `create extension postgis;` on the database" };
      }
      return { status: 'ok', time, db };
    } catch (err) {
      reply.code(503);
      return { status: 'down', time, db: { connected: false }, error: (err as Error).message };
    }
  });
}
