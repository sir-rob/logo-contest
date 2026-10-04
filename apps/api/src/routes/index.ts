/**
 * Route registration.
 *
 * One place that knows every route module and the prefix it lives under. Each
 * module exports a single `register*Routes(app)` function and registers its
 * own auth guards — there is no "protect everything under /admin" wildcard,
 * because a wildcard that silently stops matching is exactly how an admin
 * route ends up open.
 */

import type { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth.js';
import { registerContestRoutes } from './contest.js';
import { registerSubmissionRoutes } from './submissions.js';
import { registerBallotRoutes } from './ballots.js';
import { registerResultsRoutes } from './results.js';
import { registerAdminRoutes } from './admin.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (scope) => {
      await registerAuthRoutes(scope);
      await registerContestRoutes(scope);
      await registerSubmissionRoutes(scope);
      await registerBallotRoutes(scope);
      await registerResultsRoutes(scope);
      await registerAdminRoutes(scope);
    },
    { prefix: '/api' },
  );
}
