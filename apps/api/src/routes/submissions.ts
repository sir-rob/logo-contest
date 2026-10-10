/**
 * Submission routes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ANONYMITY NOTES FOR REVIEWERS
 *
 * Every response on this router is built through `toPublicDto`, which has no
 * way to emit `ownerUid`. Nothing here serialises a Firestore entity directly.
 *
 * Two rules below look like bugs and are not:
 *   • A non-owner touching someone else's entry gets SUBMISSION_NOT_FOUND,
 *     never FORBIDDEN. See `loadOwnEntry`.
 *   • Gallery order is shuffled, never chronological. See `orderSubmissionsForViewer`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiError,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  SubmissionMetaSchema,
  type PublicSubmissionDto,
  type Submission,
} from '@contest/shared';
import { emailLocalPart, getConfig, now } from '../config.js';
import { getDb } from '../firebase.js';
import { submissionDoc, submissionsCol } from '../db/collections.js';
import { principalOf } from '../plugins/auth.js';
import { assertCanSubmit, assertCanViewGallery, loadRequestContestWithPhase } from '../services/contest.js';
import { toPublicDto, toPublicDtos } from '../services/submission-dto.js';
import { deletePrefix, newStoragePrefix, renditionPath, uploadObject } from '../services/storage.js';
import { assignAliasesIfDue, orderSubmissionsForViewer } from '../services/aliases.js';
import { processUpload } from '../services/images.js';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Fold `.`, `_` and `-` into spaces and collapse runs of whitespace.
 *
 * Identity-hiding games are almost always punctuation games: `by_sam`,
 * `sam.rivera`, `sam-rivera`. Treating those separators as spaces on BOTH the
 * haystack and the needles means one word-boundary match catches all spellings.
 */
function foldSeparators(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape a token for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The set of strings that would identify this author if they appeared in text.
 *
 * Exported so the truth table in the tests can explain its own failures.
 *
 * Tokens of 1–2 characters are dropped. A two-letter name fragment matches far
 * too much ordinary English ("Jo", "Al", "Ed" as words), and a contest that
 * rejects the title "Ed Sign Concept" from someone not named Ed is a contest
 * people stop using. We accept that a genuinely two-letter display name slips
 * through this net; the description check and human moderation cover it.
 */
export function authorIdentityTokens(displayName: string, email: string): string[] {
  const tokens = new Set<string>();

  const add = (raw: string): void => {
    const value = foldSeparators(raw);
    if (value.length >= 3) tokens.add(value);
  };

  // The email local part, both whole and split. `sam.rivera` must catch a
  // title containing "sam", "rivera", or "sam rivera".
  if (email.includes('@') || email.length > 0) {
    const local = emailLocalPart(email);
    add(local);
    for (const part of foldSeparators(local).split(' ')) add(part);
  }

  // The full display name as a phrase, plus each of its words.
  add(displayName);
  for (const part of foldSeparators(displayName).split(' ')) add(part);

  return [...tokens].filter((t) => t.length >= 3);
}

/**
 * Does this text identify its author?
 *
 * Matching is on WORD BOUNDARIES, which is the whole subtlety:
 *   • "sam's logo"  → trips (apostrophe is a boundary)
 *   • "by_sam"      → trips (underscore folded to a space)
 *   • "Samurai"     → does NOT trip ("sam" is not a whole word there)
 *   • "Sam"         → trips regardless of case
 *
 * A substring search would reject "Samurai Crest" from a designer named Sam,
 * and false positives here are maddening — the entrant cannot see why their
 * title is refused and has no way to argue with it. Boundaries buy precision
 * cheaply.
 */
export function titleIdentifiesAuthor(title: string, displayName: string, email: string): boolean {
  const haystack = foldSeparators(title);
  if (haystack.length === 0) return false;

  for (const token of authorIdentityTokens(displayName, email)) {
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(token)}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
    if (pattern.test(haystack)) return true;
  }
  return false;
}

/**
 * Parse a multipart text field into a boolean.
 *
 * NOT `z.coerce.boolean()`: that is `Boolean(value)`, so the string "false"
 * — which is exactly what an HTML form sends for an unchecked-then-scripted
 * control — coerces to TRUE. Silently opting someone into being named as the
 * winner when they said no is the worst possible direction for this bug.
 */
export function parseBooleanField(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

/** Empty multipart fields arrive as "", which must mean "absent", not "". */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The storage prefix a rendition path sits under. */
function prefixOfPath(path: string): string | null {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? null : path.slice(0, idx);
}

/**
 * Validate the free-text metadata and the anonymity rule over it.
 *
 * The author check runs over the description as well as the title: the
 * description is shown in the gallery too, and "designed by sam" there leaks
 * exactly as much as it would in the title.
 */
function assertMetaIsAnonymous(
  title: string | undefined,
  description: string | undefined,
  displayName: string,
  email: string,
): void {
  if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
    throw new ApiError('VALIDATION_FAILED', undefined, { title: `Keep the title under ${MAX_TITLE_LENGTH} characters.` });
  }
  if (description !== undefined && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ApiError('VALIDATION_FAILED', undefined, {
      description: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`,
    });
  }
  if (title !== undefined && titleIdentifiesAuthor(title, displayName, email)) {
    throw new ApiError('SUBMISSION_TITLE_IDENTIFIES_AUTHOR', undefined, {
      title: 'Entries are anonymous — please leave your name out of the title.',
    });
  }
  if (description !== undefined && titleIdentifiesAuthor(description, displayName, email)) {
    throw new ApiError('SUBMISSION_TITLE_IDENTIFIES_AUTHOR', undefined, {
      description: 'Entries are anonymous — please leave your name out of the description.',
    });
  }
}

// ---------------------------------------------------------------------------
// Multipart intake
// ---------------------------------------------------------------------------

interface UploadPayload {
  bytes: Buffer;
  declaredMime: string;
  title: string | undefined;
  description: string | undefined;
  creditOptIn: boolean;
}

/**
 * Drain the multipart body.
 *
 * `request.parts()` rather than `request.file()` because the latter only
 * exposes text fields that happened to arrive BEFORE the file part, and field
 * order is decided by the client. Iterating every part makes intake
 * independent of how the browser chose to serialise the form.
 */
async function readUpload(request: FastifyRequest): Promise<UploadPayload> {
  const fields = new Map<string, string>();
  let bytes: Buffer | null = null;
  let declaredMime = 'application/octet-stream';

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || bytes !== null) {
        // Drain unexpected/duplicate file parts so the stream does not stall.
        await part.toBuffer();
        continue;
      }
      bytes = await part.toBuffer();
      declaredMime = part.mimetype;
      // @fastify/multipart truncates at the configured fileSize rather than
      // throwing. An un-checked truncation would be stored as a "corrupt
      // image" instead of the honest "too large".
      if (part.file.truncated) throw new ApiError('SUBMISSION_TOO_LARGE');
    } else if (typeof part.value === 'string') {
      fields.set(part.fieldname, part.value);
    }
  }

  if (bytes === null) {
    throw new ApiError('VALIDATION_FAILED', 'An image file is required.', { file: 'Choose an image to upload.' });
  }

  // Run the text through the shared schema too, so the API and the web app
  // enforce byte-identical limits. `creditOptIn` is pre-parsed to a real
  // boolean first — see `parseBooleanField`.
  const meta = SubmissionMetaSchema.parse({
    title: optionalText(fields.get('title')),
    description: optionalText(fields.get('description')),
    creditOptIn: parseBooleanField(fields.get('creditOptIn')),
  });

  return {
    bytes,
    declaredMime,
    title: meta.title,
    description: meta.description,
    creditOptIn: meta.creditOptIn,
  };
}

// ---------------------------------------------------------------------------
// Owner lookup
// ---------------------------------------------------------------------------

/**
 * Load an entry that the caller owns, or throw SUBMISSION_NOT_FOUND.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NOT 403 FOR A NON-OWNER
 *
 * Returning FORBIDDEN would confirm "this id exists and belongs to somebody
 * else", while a genuinely unknown id returns NOT_FOUND. That difference is a
 * de-anonymisation oracle: entry ids are visible to every member in the
 * gallery, so anyone could probe ids and learn which ones are *theirs* by
 * elimination — and in a field of a dozen colleagues, narrowing ownership by
 * elimination is most of the way to naming names.
 *
 * Both cases therefore return the same 404 with the same message. The caller
 * learns only "not yours", which is all they are entitled to know.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function loadOwnEntry(id: string, ownerUid: string, contestId: string): Promise<Submission> {
  const snap = await submissionDoc(id).get();
  const submission = snap.data();
  if (!submission) throw new ApiError('SUBMISSION_NOT_FOUND');
  if (submission.contestId !== contestId) throw new ApiError('SUBMISSION_NOT_FOUND');
  if (submission.ownerUid !== ownerUid) throw new ApiError('SUBMISSION_NOT_FOUND');
  // A withdrawn or disqualified entry is not editable. Same opaque answer.
  if (submission.status !== 'active') throw new ApiError('SUBMISSION_NOT_FOUND');
  return submission;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface IdParams {
  id: string;
}

export async function registerSubmissionRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /submissions — the anonymous gallery
  // -------------------------------------------------------------------------
  app.get('/submissions', { preHandler: app.requireAuth }, async (request: FastifyRequest) => {
    const principal = principalOf(request);
    const { contest, phase } = await loadRequestContestWithPhase(request, principal);
    assertCanViewGallery(phase);

    // Idempotent and cheap once done: a single contest read on the hot path.
    // Doing it here rather than on a timer means the labels appear the instant
    // the phase turns over, with no scheduler to fail silently.
    await assignAliasesIfDue(contest.id);

    // Only `active` entries. Withdrawn ones vanish from the gallery, and
    // disqualified ones must not be visible at all.
    const snap = await submissionsCol()
      .where('contestId', '==', contest.id)
      .where('status', '==', 'active')
      .get();

    const submissions = snap.docs.map((d) => d.data());
    const ordered = orderSubmissionsForViewer(submissions, contest.tieBreakSeed, principal.uid);
    return { submissions: await toPublicDtos(ordered, principal.uid) };
  });

  // -------------------------------------------------------------------------
  // POST /submissions — create or replace the caller's entry
  // -------------------------------------------------------------------------
  app.post('/submissions', { preHandler: app.requireAuth }, async (request: FastifyRequest) => {
    const principal = principalOf(request);
    const { contest, phase } = await loadRequestContestWithPhase(request, principal);
    assertCanSubmit(phase);

    const payload = await readUpload(request);
    assertMetaIsAnonymous(payload.title, payload.description, principal.displayName, principal.email);

    const processed = await processUpload(payload.bytes, payload.declaredMime);

    // Upload to a FRESH prefix before touching Firestore. If an upload fails
    // we have orphaned objects (cheap, sweepable) rather than a document
    // pointing at images that do not exist (a broken gallery tile for
    // everyone). Renditions are immutable, so a replace never overwrites the
    // old prefix — it writes a new one and deletes the old afterwards.
    const prefix = newStoragePrefix(contest.id);
    const displayPath = renditionPath(prefix, 'display');
    const thumbPath = renditionPath(prefix, 'thumb');
    // NOTE: `renditionPath` only knows the two served renditions. The retained
    // original keeps its real extension and is composed here; it is stored for
    // provenance and re-rendering and is NEVER served to a member.
    const originalPath = `${prefix}/original.${processed.original.ext}`;

    await Promise.all([
      uploadObject(originalPath, processed.original.bytes, processed.original.contentType),
      uploadObject(displayPath, processed.display, 'image/webp'),
      uploadObject(thumbPath, processed.thumb, 'image/webp'),
    ]);

    const timestamp = now(getConfig());
    let stalePrefix: string | null = null;

    const saved = await getDb().runTransaction(async (txn): Promise<Submission> => {
      // ───────────────────────────────────────────────────────────────────
      // ONE ACTIVE ENTRY PER PERSON — enforced HERE, not by a prior read.
      //
      // Firestore transactions are optimistic with read-set validation: this
      // query's result set is part of the transaction's read set, so if a
      // concurrent transaction inserts or modifies a matching document, this
      // one aborts and RETRIES against fresh data. Two simultaneous uploads
      // from the same person therefore serialise — the second retry sees the
      // first entry and takes the replace branch instead of creating a
      // duplicate. A check-then-write outside a transaction would let both
      // reads miss and both writes land.
      // ───────────────────────────────────────────────────────────────────
      const existingSnap = await txn.get(
        submissionsCol()
          .where('contestId', '==', contest.id)
          .where('ownerUid', '==', principal.uid)
          .where('status', '==', 'active'),
      );

      const existing = existingSnap.docs[0]?.data();

      // REPLACE STRATEGY: reuse the existing document id and overwrite in
      // place. Chosen over delete-and-recreate because the id is a stable
      // handle — it may already appear in a cast ballot, and changing it would
      // silently invalidate someone's vote.
      const id = existing?.id ?? submissionsCol().doc().id;
      const createdAt = existing?.createdAt ?? timestamp;

      if (existing) {
        const old = prefixOfPath(existing.displayPath);
        if (old !== null && old !== prefix) stalePrefix = old;
      }

      // Any extra active rows (only reachable if data was hand-edited) are
      // withdrawn rather than left to violate the one-entry invariant.
      for (const doc of existingSnap.docs.slice(1)) {
        txn.update(doc.ref, { status: 'withdrawn', updatedAt: timestamp });
      }

      const submission: Submission = {
        id,
        contestId: contest.id,
        ownerUid: principal.uid,
        // A replacement inherits the alias if one was already assigned, so a
        // re-upload does not renumber the field.
        alias: existing?.alias ?? null,
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        creditOptIn: payload.creditOptIn,
        originalPath,
        displayPath,
        thumbPath,
        width: processed.width,
        height: processed.height,
        bytes: processed.original.bytes.length,
        contentHash: processed.contentHash,
        status: 'active',
        createdAt,
        updatedAt: timestamp,
      };

      txn.set(submissionDoc(id), submission);
      return submission;
    });

    // AFTER the commit, never inside it. Storage deletion is not
    // transactional: doing it earlier would destroy the live images of an
    // entry whose replacement then failed to commit. A failure here leaves
    // orphaned objects, which is a cleanup chore — not a lost submission —
    // so it is logged and swallowed rather than surfaced as a 500.
    if (stalePrefix !== null) {
      try {
        await deletePrefix(stalePrefix);
      } catch (err) {
        request.log.warn({ err, prefix: stalePrefix }, 'Failed to delete replaced submission renditions.');
      }
    }

    return toPublicDto(saved, principal.uid);
  });

  // -------------------------------------------------------------------------
  // PATCH /submissions/:id — edit your own metadata
  // -------------------------------------------------------------------------
  app.patch<{ Params: IdParams }>(
    '/submissions/:id',
    { preHandler: app.requireAuth },
    async (request): Promise<PublicSubmissionDto> => {
      const principal = principalOf(request);
      const existingSnap = await submissionDoc(request.params.id).get();
      const targetContestId = existingSnap.data()?.contestId;
      const { contest, phase } = targetContestId
        ? await (async () => {
            const c = await loadRequestContestWithPhase(
              { ...request, query: { ...(request.query as object), contestId: targetContestId } } as FastifyRequest,
              principal,
            );
            return c;
          })()
        : await loadRequestContestWithPhase(request, principal);
      assertCanSubmit(phase);

      const existing = await loadOwnEntry(request.params.id, principal.uid, contest.id);

      const raw: Record<string, unknown> = typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
      const body = SubmissionMetaSchema.parse(raw);

      // `creditOptIn` carries a schema default of `false`, so parsing a PATCH
      // that omits it would quietly revoke a previously granted credit
      // opt-in. Only apply the field when the client actually sent it.
      const title = 'title' in raw ? optionalText(body.title) : existing.title;
      const description = 'description' in raw ? optionalText(body.description) : existing.description;
      const creditOptIn = 'creditOptIn' in raw ? body.creditOptIn : existing.creditOptIn;

      // Re-run on every edit: the check at upload time is worthless if the
      // title can be changed to a name afterwards.
      assertMetaIsAnonymous(title, description, principal.displayName, principal.email);

      const timestamp = now(getConfig());
      await submissionDoc(existing.id).update({
        title: title ?? null,
        description: description ?? null,
        creditOptIn,
        updatedAt: timestamp,
      });

      const updated: Submission = {
        ...existing,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        creditOptIn,
        updatedAt: timestamp,
      };
      if (title === undefined) delete updated.title;
      if (description === undefined) delete updated.description;

      return toPublicDto(updated, principal.uid);
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /submissions/:id — withdraw your own entry
  // -------------------------------------------------------------------------
  app.delete<{ Params: IdParams }>(
    '/submissions/:id',
    { preHandler: app.requireAuth },
    async (request, reply: FastifyReply): Promise<void> => {
      const principal = principalOf(request);
      const existingSnap = await submissionDoc(request.params.id).get();
      const targetContestId = existingSnap.data()?.contestId;
      const { contest, phase } = targetContestId
        ? await loadRequestContestWithPhase(
            { ...request, query: { ...(request.query as object), contestId: targetContestId } } as FastifyRequest,
            principal,
          )
        : await loadRequestContestWithPhase(request, principal);
      assertCanSubmit(phase);

      const existing = await loadOwnEntry(request.params.id, principal.uid, contest.id);

      // SOFT delete. The entry may already be ranked on ballots that were cast
      // while it was visible; hard-deleting it would leave those ballots
      // pointing at a missing id. The counting engine skips non-active
      // entries, which is a well-defined behaviour — a dangling reference is
      // not. Storage objects are kept for the same reason.
      await submissionDoc(existing.id).update({
        status: 'withdrawn',
        updatedAt: now(getConfig()),
      });

      await reply.code(204).send();
    },
  );
}
