/**
 * Contest configuration and registration — the member-facing read and join routes.
 *
 * `GET /contest` is the single call the whole UI makes to learn what phase it
 * is and when the next deadline falls.
 *
 * `GET /contests` returns all contests the caller has access to (every contest
 * for administrators; registered contests for regular members).
 *
 * `POST /contests/join` registers the caller for a contest using the unique
 * contest code shared by an administrator.
 *
 * Nothing here is admin-only; the admin write side lives in `admin.ts`.
 */

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  ApiError,
  ContestPublicSchema,
  JoinContestSchema,
  normaliseContestCode,
  type ContestPublicDto,
} from '@contest/shared';
import { getConfig } from '../config.js';
import { userDoc } from '../db/collections.js';
import { principalOf } from '../plugins/auth.js';
import { zodErrorToFields } from '../plugins/error-handler.js';
import { contestToDto, listAllContests, loadRequestContest } from '../services/contest.js';

export async function registerContestRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /contest — the phase/deadline poll for a single contest.
   *
   * Accepts `?contestId=...` (or `x-contest-id` header), falling back to the
   * deployment's default contest.
   */
  app.get('/contest', { preHandler: app.requireAuth }, async (request): Promise<ContestPublicDto> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);
    return ContestPublicSchema.parse(contestToDto(contest, config));
  });

  /**
   * GET /contests — all contests accessible to the signed-in caller.
   *
   *   - Admins see all contests.
   *   - Members see only the contests they have registered for with a contest code.
   */
  app.get(
    '/contests',
    { preHandler: app.requireAuth },
    async (request): Promise<{ contests: ContestPublicDto[] }> => {
      const principal = principalOf(request);
      const config = getConfig();
      const all = await listAllContests();

      const accessible =
        principal.role === 'admin'
          ? all
          : all.filter((c) => principal.user.registeredContestIds.includes(c.id));

      return {
        contests: accessible.map((c) => ContestPublicSchema.parse(contestToDto(c, config))),
      };
    },
  );

  /**
   * POST /contests/join — register for a contest using its unique code.
   */
  app.post(
    '/contests/join',
    { preHandler: app.requireAuth },
    async (request): Promise<{ contest: ContestPublicDto }> => {
      const principal = principalOf(request);
      const config = getConfig();

      let body;
      try {
        body = JoinContestSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new ApiError('VALIDATION_FAILED', undefined, zodErrorToFields(err));
        }
        throw err;
      }

      const targetCode = normaliseContestCode(body.code);
      const all = await listAllContests();
      const match = all.find((c) => normaliseContestCode(c.code) === targetCode);

      if (!match) {
        throw new ApiError('CONTEST_CODE_INVALID');
      }

      const existingIds = principal.user.registeredContestIds ?? [];
      if (!existingIds.includes(match.id)) {
        const updatedIds = [...existingIds, match.id];
        await userDoc(principal.uid).update({ registeredContestIds: updatedIds });
        principal.user.registeredContestIds = updatedIds;
      }

      return {
        contest: ContestPublicSchema.parse(contestToDto(match, config)),
      };
    },
  );
}
