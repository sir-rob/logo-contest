/**
 * The typed API client.
 *
 * Every response shape here comes from `@contest/shared`'s `api.ts`, which is
 * the anonymity boundary. If a field is not in the DTO, the client cannot see
 * it — and if the server ever started sending one, nothing here would surface
 * it.
 *
 * Errors are normalised into `ApiClientError`, which carries the machine
 * `ErrorCode`. UI code switches on that code rather than matching on prose.
 */

import {
  ApiErrorSchema,
  ContestPublicSchema,
  DashboardSchema,
  MeSchema,
  ModerationSubmissionSchema,
  PublicSubmissionSchema,
  ResultsSchema,
  TurnoutRowSchema,
  AuditRowSchema,
  DEFAULT_ERROR_MESSAGES,
  type AuditRowDto,
  type ContestPublicDto,
  type DashboardDto,
  type DisqualifyBody,
  type ErrorCode,
  type MeDto,
  type ModerationSubmissionDto,
  type PublicSubmissionDto,
  type ResolveTieBody,
  type ResultsDto,
  type Role,
  type SetPhaseBody,
  type UpdateContestBody,
} from '@contest/shared';
import { z } from 'zod';
import { currentIdToken } from './firebase';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True for the codes where re-authenticating is the right remedy. */
  get isAuthProblem(): boolean {
    return (
      this.code === 'AUTH_REQUIRED' ||
      this.code === 'AUTH_INVALID_TOKEN' ||
      this.code === 'AUTH_LINK_EXPIRED'
    );
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Multipart upload; `body` is ignored when set. */
  formData?: FormData;
  /** Skip the Authorization header (only the magic-link request does this). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};

  if (!options.anonymous) {
    const token = await currentIdToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body !== undefined && !options.formData) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.signal) init.signal = options.signal;
  if (options.formData) init.body = options.formData;
  else if (options.body !== undefined) init.body = JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    // Network failure, not an API failure. Present it as INTERNAL so callers
    // only ever deal with one error type.
    throw new ApiClientError('INTERNAL', 'Could not reach the server. Check your connection.', 0);
  }

  if (response.ok) return response;

  let parsedCode: ErrorCode = 'INTERNAL';
  let message = DEFAULT_ERROR_MESSAGES.INTERNAL;
  let fields: Record<string, string> | undefined;
  let retryAfter: number | undefined;

  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      parsedCode = parsed.data.error.code;
      message = parsed.data.error.message;
      fields = parsed.data.error.fields;
      retryAfter = parsed.data.error.retryAfter;
    }
  } catch {
    // Non-JSON error body (a proxy 502, say). Defaults above are fine.
  }

  throw new ApiClientError(parsedCode, message, response.status, fields, retryAfter);
}

/**
 * Fetch + validate against a DTO schema. A drift shows up here, loudly.
 *
 * The generic is the SCHEMA, not the parsed type. Several DTOs use zod
 * `.default()` (`Round.eliminated`, `ModerationSubmission.duplicateOf`), which
 * makes a schema's INPUT type differ from its OUTPUT type — the field is
 * optional going in and guaranteed coming out. `z.ZodType<T>` collapses those
 * two into one parameter and would bind `T` to the input shape, so every
 * method annotated with a DTO type (which is `z.infer`, i.e. the OUTPUT) would
 * fail to typecheck. Inferring `z.output<S>` is what `.parse()` actually
 * returns, and it matches the DTOs exactly.
 */
async function getJson<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await request(path, options);
  const body: unknown = await response.json();
  return schema.parse(body) as z.output<S>;
}

// ---------------------------------------------------------------------------
// Response envelopes the server returns for list routes
// ---------------------------------------------------------------------------

const SubmissionsResponseSchema = z.object({ submissions: z.array(PublicSubmissionSchema) });
const ModerationResponseSchema = z.object({ submissions: z.array(ModerationSubmissionSchema) });
const BallotResponseSchema = z.object({ ranking: z.array(z.string()).nullable() });
const TurnoutResponseSchema = z.object({
  rows: z.array(TurnoutRowSchema),
  eligible: z.number().int(),
  voted: z.number().int(),
});
const AuditResponseSchema = z.object({ rows: z.array(AuditRowSchema) });
const OkSchema = z.object({ ok: z.boolean() });

export type TurnoutResponse = z.infer<typeof TurnoutResponseSchema>;

// ---------------------------------------------------------------------------
// Public / member surface
// ---------------------------------------------------------------------------

export const api = {
  /**
   * Ask the server to send a magic link. Anonymous by necessity — the caller
   * has no token yet. The server checks the domain allowlist and the rate
   * limits BEFORE any mail is sent.
   */
  async requestMagicLink(email: string): Promise<void> {
    await request('/auth/magic-link', { method: 'POST', body: { email }, anonymous: true });
  },

  me: (): Promise<MeDto> => getJson('/me', MeSchema),

  updateProfile: (displayName: string): Promise<MeDto> =>
    getJson('/me', MeSchema, { method: 'PATCH', body: { displayName } }),

  contest: (): Promise<ContestPublicDto> => getJson('/contest', ContestPublicSchema),

  submissions: async (): Promise<PublicSubmissionDto[]> =>
    (await getJson('/submissions', SubmissionsResponseSchema)).submissions,

  /** Upload or replace the caller's single entry. */
  async upsertSubmission(input: {
    file: File;
    title?: string;
    description?: string;
    creditOptIn?: boolean;
  }): Promise<PublicSubmissionDto> {
    const form = new FormData();
    form.append('file', input.file);
    if (input.title) form.append('title', input.title);
    if (input.description) form.append('description', input.description);
    form.append('creditOptIn', String(input.creditOptIn ?? false));
    const response = await request('/submissions', { method: 'POST', formData: form });
    return PublicSubmissionSchema.parse(await response.json());
  },

  /** Edit title/description/credit without re-uploading the image. */
  updateSubmissionMeta: (
    id: string,
    meta: { title?: string; description?: string; creditOptIn?: boolean },
  ): Promise<PublicSubmissionDto> =>
    getJson(`/submissions/${encodeURIComponent(id)}`, PublicSubmissionSchema, {
      method: 'PATCH',
      body: meta,
    }),

  async withdrawSubmission(id: string): Promise<void> {
    await request(`/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** The caller's own ballot. There is no endpoint for anyone else's. */
  myBallot: async (): Promise<string[] | null> =>
    (await getJson('/ballot', BallotResponseSchema)).ranking,

  async saveBallot(ranking: string[]): Promise<void> {
    await request('/ballot', { method: 'PUT', body: { ranking } });
  },

  async clearBallot(): Promise<void> {
    await request('/ballot', { method: 'DELETE' });
  },

  dashboard: (): Promise<DashboardDto> => getJson('/dashboard', DashboardSchema),

  results: (): Promise<ResultsDto> => getJson('/results', ResultsSchema),

  // -------------------------------------------------------------------------
  // Admin. Every one of these is rejected for a non-admin token server-side;
  // hiding the UI is a convenience, not the control.
  // -------------------------------------------------------------------------
  admin: {
    updateContest: (body: UpdateContestBody): Promise<ContestPublicDto> =>
      getJson('/admin/contest', ContestPublicSchema, { method: 'PATCH', body }),

    setPhase: (body: SetPhaseBody): Promise<ContestPublicDto> =>
      getJson('/admin/contest/phase', ContestPublicSchema, { method: 'POST', body }),

    /** AUDITED: this is the only route that reveals uploader identity. */
    moderation: async (): Promise<ModerationSubmissionDto[]> =>
      (await getJson('/admin/submissions', ModerationResponseSchema)).submissions,

    disqualify: (id: string, body: DisqualifyBody): Promise<{ ok: boolean }> =>
      getJson(`/admin/submissions/${encodeURIComponent(id)}/disqualify`, OkSchema, {
        method: 'POST',
        body,
      }),

    reinstate: (id: string): Promise<{ ok: boolean }> =>
      getJson(`/admin/submissions/${encodeURIComponent(id)}/reinstate`, OkSchema, { method: 'POST' }),

    /** Who has voted. Never what they voted. */
    turnout: (): Promise<TurnoutResponse> => getJson('/admin/turnout', TurnoutResponseSchema),

    setRole: (uid: string, role: Role): Promise<{ ok: boolean }> =>
      getJson(`/admin/users/${encodeURIComponent(uid)}/role`, OkSchema, { method: 'POST', body: { role } }),

    computeResults: (): Promise<ResultsDto> => getJson('/admin/results/compute', ResultsSchema, { method: 'POST' }),

    publishResults: (): Promise<{ ok: boolean }> =>
      getJson('/admin/results/publish', OkSchema, { method: 'POST' }),

    unpublishResults: (): Promise<{ ok: boolean }> =>
      getJson('/admin/results/unpublish', OkSchema, { method: 'POST' }),

    resolveTie: (body: ResolveTieBody): Promise<ResultsDto> =>
      getJson('/admin/results/resolve-tie', ResultsSchema, { method: 'POST', body }),

    audit: async (): Promise<AuditRowDto[]> => (await getJson('/admin/audit', AuditResponseSchema)).rows,

    /** Anonymised ballots, so a skeptic can recount without learning who. */
    async exportBallotsCsv(): Promise<Blob> {
      const response = await request('/admin/export/ballots.csv');
      return response.blob();
    },
  },
};

export type ApiClient = typeof api;
