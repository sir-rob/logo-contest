/**
 * Fastify app assembly.
 *
 * Order matters here. The error handler is installed first so that a failure
 * inside any later plugin still produces a well-formed `ApiErrorBody`. CORS is
 * explicit-origin rather than `*`, because these requests carry a bearer
 * token.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ApiError, MAX_UPLOAD_BYTES } from '@contest/shared';
import { getConfig, type AppConfig } from './config.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp(config: AppConfig = getConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.isProduction
        ? {}
        : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
      // Never let a bearer token or a raw email reach the logs.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'request.body.email'],
        censor: '[redacted]',
      },
    },
    // Cloud Run terminates TLS and sets X-Forwarded-*; without this the
    // per-IP rate limiter would see one IP for the whole internet.
    trustProxy: true,
    bodyLimit: MAX_UPLOAD_BYTES + 1024 * 1024,
    disableRequestLogging: false,
  });

  await app.register(errorHandlerPlugin);

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 8,
    },
  });

  // A global backstop. The magic-link endpoint applies its own much tighter
  // limits on top of this; see routes/auth.ts.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Rate-limit failures must still look like every other API error.
    errorResponseBuilder: (_req, context) =>
      new ApiError('RATE_LIMITED', undefined, undefined, Math.ceil(context.ttl / 1000)).toBody(),
  });

  await app.register(authPlugin);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({ ok: true, phase: 'ready' }));

  await registerRoutes(app);

  return app;
}
