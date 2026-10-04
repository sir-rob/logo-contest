/**
 * Process entry point.
 *
 * Cloud Run sends SIGTERM and then waits; closing Fastify cleanly lets
 * in-flight image uploads finish instead of dying mid-write.
 */

import 'dotenv/config';
import { buildApp } from './app.js';
import { getConfig } from './config.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp(config);

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      port: config.port,
      projectId: config.projectId,
      allowedDomains: config.allowedDomains,
      emulators: config.useEmulators,
      fakeClock: config.fakeNow?.toISOString() ?? null,
    },
    'api listening',
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
