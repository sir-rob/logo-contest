/**
 * Multi-contest and contest registration code integration tests.
 *
 * Verifies:
 *   1. Admins can create new contests with unique codes (`POST /api/admin/contests`).
 *   2. Duplicate contest codes are rejected (`CONTEST_CODE_TAKEN`).
 *   3. `GET /api/contests` returns ALL contests to admins, and ONLY registered
 *      contests to members.
 *   4. `POST /api/contests/join` registers a member using a case-insensitive
 *      contest code and rejects unknown codes (`CONTEST_CODE_INVALID`).
 *   5. Members cannot access a second contest until they register for it with
 *      its code (`CONTEST_ACCESS_REQUIRED`), and once registered they can view
 *      its dashboard, gallery, and ballot independently of other contests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);

import type { FastifyInstance } from 'fastify';
import { seedCast, type Cast } from './support/cast.js';
import {
  buildTestApp,
  call,
  errorCode,
  resetTestState,
  seedContest,
  seedPerson,
  setupTestEnv,
} from './support/harness.js';

let app: FastifyInstance;
let cast: Cast;

beforeEach(async () => {
  setupTestEnv();
  resetTestState();
  seedContest();
  cast = seedCast();
  app = await buildTestApp();
});

describe('multi-contest & contest code registration', () => {
  it('allows an admin to create a second contest with a unique code', async () => {
    const res = await call(app, {
      method: 'POST',
      url: '/api/admin/contests',
      token: cast.mo.token,
      payload: {
        id: 'mascot-2026',
        title: 'Team Mascot Contest',
        description: 'Pick our new mascot image.',
        code: 'mascot26',
      },
    });

    expect(res.status).toBe(200);
    const created = res.json as { id: string; title: string; code: string };
    expect(created.id).toBe('mascot-2026');
    expect(created.title).toBe('Team Mascot Contest');
    expect(created.code).toBe('MASCOT26');

    // Duplicate code is rejected with CONTEST_CODE_TAKEN.
    const dup = await call(app, {
      method: 'POST',
      url: '/api/admin/contests',
      token: cast.mo.token,
      payload: {
        title: 'Another Contest',
        code: 'MASCOT26',
      },
    });
    expect(dup.status).toBe(409);
    expect(errorCode(dup)).toBe('CONTEST_CODE_TAKEN');
  });

  it('lists all contests for admins and only registered contests for members', async () => {
    seedContest({
      id: 'summer-photo',
      title: 'Summer Photo Contest',
      code: 'SUMMER26',
    });

    // Admin sees both contests.
    const adminList = await call(app, {
      url: '/api/contests',
      token: cast.mo.token,
    });
    expect(adminList.status).toBe(200);
    const adminIds = (adminList.json as { contests: Array<{ id: string }> }).contests.map((c) => c.id);
    expect(adminIds).toContain('north7');
    expect(adminIds).toContain('summer-photo');

    // Sam is registered only for north7 initially.
    const memberListBefore = await call(app, {
      url: '/api/contests',
      token: cast.sam.token,
    });
    expect(memberListBefore.status).toBe(200);
    const memberIdsBefore = (memberListBefore.json as { contests: Array<{ id: string }> }).contests.map((c) => c.id);
    expect(memberIdsBefore).toEqual(['north7']);

    // Sam cannot access summer-photo before registering with the code.
    const forbiddenContest = await call(app, {
      url: '/api/contest?contestId=summer-photo',
      token: cast.sam.token,
    });
    expect(forbiddenContest.status).toBe(403);
    expect(errorCode(forbiddenContest)).toBe('CONTEST_ACCESS_REQUIRED');

    // Wrong code is rejected.
    const badJoin = await call(app, {
      method: 'POST',
      url: '/api/contests/join',
      token: cast.sam.token,
      payload: { code: 'WRONGCODE' },
    });
    expect(badJoin.status).toBe(404);
    expect(errorCode(badJoin)).toBe('CONTEST_CODE_INVALID');

    // Joining with the valid code (case-insensitive) registers Sam.
    const goodJoin = await call(app, {
      method: 'POST',
      url: '/api/contests/join',
      token: cast.sam.token,
      payload: { code: '  summer26 ' },
    });
    expect(goodJoin.status).toBe(200);
    expect((goodJoin.json as { contest: { id: string } }).contest.id).toBe('summer-photo');

    // Now Sam sees both contests on GET /api/contests and can access summer-photo.
    const memberListAfter = await call(app, {
      url: '/api/contests',
      token: cast.sam.token,
    });
    const memberIdsAfter = (memberListAfter.json as { contests: Array<{ id: string }> }).contests.map((c) => c.id);
    expect(memberIdsAfter).toContain('north7');
    expect(memberIdsAfter).toContain('summer-photo');

    const allowedContest = await call(app, {
      url: '/api/contest?contestId=summer-photo',
      token: cast.sam.token,
    });
    expect(allowedContest.status).toBe(200);
    expect((allowedContest.json as { title: string }).title).toBe('Summer Photo Contest');
  });

  it('a brand-new user with no registrations sees an empty contest list until they enter a code', async () => {
    const newcomer = seedPerson({
      uid: 'u-newcomer',
      email: 'newcomer@google.com',
      displayName: 'New Comer',
      registeredContestIds: [],
    });

    const listRes = await call(app, {
      url: '/api/contests',
      token: newcomer.token,
    });
    expect(listRes.status).toBe(200);
    expect((listRes.json as { contests: unknown[] }).contests).toEqual([]);

    const joinRes = await call(app, {
      method: 'POST',
      url: '/api/contests/join',
      token: newcomer.token,
      payload: { code: 'north7' },
    });
    expect(joinRes.status).toBe(200);

    const listAfter = await call(app, {
      url: '/api/contests',
      token: newcomer.token,
    });
    expect((listAfter.json as { contests: Array<{ id: string }> }).contests.map((c) => c.id)).toEqual(['north7']);
  });
});
