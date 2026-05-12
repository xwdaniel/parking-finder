import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './config';
import { healthRoutes } from './routes/health';
import { zoneRoutes } from './routes/zones';

export function buildServer() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  // The RN app calls this from the device; CORS is permissive for now and tightened
  // once there's a stable client origin / a debug web view to lock down.
  void app.register(cors, { origin: true });

  void app.register(healthRoutes);
  void app.register(zoneRoutes);

  app.get('/', async () => ({ name: 'parkfree-backend', version: '0.1.0', ok: true }));

  return app;
}

async function start(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Start only when run directly, so buildServer() can be imported (e.g. in tests).
if (require.main === module) {
  void start();
}
