/**
 * A fixed cast of test identities, shared by the anonymity suites.
 *
 * The names are deliberately distinctive ("Priya Venkataraman", not "Bob").
 * The leak scanner looks for these strings ANYWHERE in a response, so a common
 * name would produce false positives against innocent prose, and a short one
 * would produce them against base64 and URLs. Distinctive names make a hit
 * mean exactly one thing: that identity reached the wire.
 */

import { seedPerson, seedSubmission, type TestPerson } from './harness.js';
import type { ForeignIdentities } from './identity-leak.js';

export interface Cast {
  /** The member whose token the tests use. Their own identity is allowed. */
  sam: TestPerson;
  priya: TestPerson;
  devon: TestPerson;
  /** An admin, so admin-only routes can be exercised. */
  mo: TestPerson;
  /** Everybody who is NOT the caller. */
  others: TestPerson[];
}

export const ENTRY_SAM = 'sub-alpha';
export const ENTRY_PRIYA = 'sub-bravo';
export const ENTRY_DEVON = 'sub-charlie';
export const ENTRY_MO = 'sub-delta';

/** Register four people and one entry each. */
export function seedCast(): Cast {
  const sam = seedPerson({ uid: 'u-sam-1', email: 'sam.rivera@google.com', displayName: 'Sam Rivera' });
  const priya = seedPerson({
    uid: 'u-priya-2',
    email: 'priya.venkataraman@google.com',
    displayName: 'Priya Venkataraman',
  });
  const devon = seedPerson({ uid: 'u-devon-3', email: 'devon.okonkwo@google.com', displayName: 'Devon Okonkwo' });
  const mo = seedPerson({
    uid: 'u-mo-4',
    email: 'mo.tanaka@google.com',
    displayName: 'Mo Tanaka',
    role: 'admin',
  });

  const base = Date.UTC(2026, 4, 1, 9, 0, 0);
  const hour = 60 * 60 * 1000;
  seedSubmission({ id: ENTRY_SAM, ownerUid: sam.uid, alias: 'Entry 03', createdAt: new Date(base) });
  seedSubmission({ id: ENTRY_PRIYA, ownerUid: priya.uid, alias: 'Entry 01', createdAt: new Date(base + hour) });
  seedSubmission({ id: ENTRY_DEVON, ownerUid: devon.uid, alias: 'Entry 04', createdAt: new Date(base + 2 * hour) });
  seedSubmission({ id: ENTRY_MO, ownerUid: mo.uid, alias: 'Entry 02', createdAt: new Date(base + 3 * hour) });

  return { sam, priya, devon, mo, others: [priya, devon, mo] };
}

/** Everyone the caller must not be able to identify from a response. */
export function foreignTo(caller: TestPerson, cast: Cast): ForeignIdentities {
  const everyone = [cast.sam, cast.priya, cast.devon, cast.mo];
  const strangers = everyone.filter((p) => p.uid !== caller.uid);
  return {
    uids: strangers.map((p) => p.uid),
    emails: strangers.map((p) => p.email),
    displayNames: strangers.map((p) => p.displayName),
  };
}

/** The caller's own identity, which some routes may legitimately echo. */
export function ownIdentity(caller: TestPerson): {
  uids: string[];
  emails: string[];
  displayNames: string[];
} {
  return { uids: [caller.uid], emails: [caller.email], displayNames: [caller.displayName] };
}
