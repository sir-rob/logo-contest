/**
 * Contest configuration — the member-facing read.
 *
 * `GET /contest` is the single call the whole UI makes to learn what phase it
 * is and when the next deadline falls. Every countdown, every enabled or
 * disabled button, hangs off this response, so it goes through
 * `contestToDto` — which derives the phase with the same `derivePhase` the web
 * app imports. There is exactly one definition of "what phase is it", and both
 * sides use it.
 *
 * Nothing here is admin-only; the admin write side lives in `admin.ts`.
 */

import type { FastifyInstance } from 'fastify';
import { ContestPublicSchema, type ContestPublicDto } from '@contest/shared';
import { contestToDto, loadDefaultContest } from '../services/contest.js';

export async function registerContestRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /contest — the phase/deadline poll.
   *
   * Authenticated but not admin-gated: every member needs it to render
   * anything at all. It carries no entry data and no identities, only the
   * contest's own configuration plus `serverNow` so a client countdown stays
   * honest against a skewed laptop clock.
   */
  app.get('/contest', { preHandler: app.requireAuth }, async (): Promise<ContestPublicDto> => {
    const contest = await loadDefaultContest();
    // Parse on the way out: a DTO drift fails loudly here on the server
    // rather than silently in a client that quietly renders `undefined`.
    return ContestPublicSchema.parse(contestToDto(contest));
  });
}
