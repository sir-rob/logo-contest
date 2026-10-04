/**
 * One error handler for the whole API.
 *
 * Routes throw `ApiError` (or a zod `ZodError`); nothing else in the codebase
 * writes an error response by hand. That means the shape on the wire is
 * guaranteed to match `ApiErrorSchema` and the client's `ErrorCode` switch can
 * be exhaustive.
 *
 * Unrecognised errors become a bare INTERNAL with a generic message. The real
 * detail goes to the log, never to the caller — an exception message can carry
 * a document id, a field name, or an email address.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ApiError, ERROR_CODES, type ErrorCode } from '@contest/shared';

/** Flatten a ZodError into the `fields` map the DTO declares. */
export function zodErrorToFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    // First message per field wins; a cascade of messages for one input is noise.
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Normalise anything thrown into an `ApiError`. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return new ApiError('VALIDATION_FAILED', undefined, zodErrorToFields(err));
  }

  const maybe = err as { validation?: unknown; statusCode?: number; code?: string } | null;

  // Fastify's own schema validation.
  if (maybe?.validation) return new ApiError('VALIDATION_FAILED');

  // @fastify/rate-limit and friends signal through statusCode.
  if (maybe?.statusCode === 429) return new ApiError('RATE_LIMITED');
  if (maybe?.statusCode === 404) return new ApiError('NOT_FOUND');
  if (maybe?.code === 'FST_REQ_FILE_TOO_LARGE') return new ApiError('SUBMISSION_TOO_LARGE');

  // Something already shaped like our wire format.
  //
  // @fastify/rate-limit passes `errorResponseBuilder`'s RETURN VALUE through
  // here rather than sending it directly. That value is a plain `.toBody()`
  // object — not an `ApiError`, no `statusCode` — so every branch above misses
  // it and a correct 429 was being flattened into a bare 500, discarding the
  // retry-after the builder had just computed.
  //
  // That mattered more than it looks: the magic-link endpoint is the only
  // anonymous, internet-facing route in the app, so a throttled sign-in
  // answered with an opaque INTERNAL. The UI could not show the "try again in
  // N seconds" countdown, and monitoring could not tell throttling from an
  // outage.
  const body = err as {
    error?: { code?: unknown; message?: unknown; fields?: unknown; retryAfter?: unknown };
  } | null;
  const wireCode = body?.error?.code;
  if (typeof wireCode === 'string' && (ERROR_CODES as readonly string[]).includes(wireCode)) {
    return new ApiError(
      wireCode as ErrorCode,
      typeof body?.error?.message === 'string' ? body.error.message : undefined,
      typeof body?.error?.fields === 'object' && body.error.fields !== null
        ? (body.error.fields as Record<string, string>)
        : undefined,
      typeof body?.error?.retryAfter === 'number' ? body.error.retryAfter : undefined,
    );
  }

  return new ApiError('INTERNAL');
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const apiError = toApiError(err);

    if (apiError.code === 'INTERNAL') {
      request.log.error({ err, url: request.url, method: request.method }, 'unhandled error');
    } else {
      request.log.info(
        { code: apiError.code, url: request.url, method: request.method },
        'request rejected',
      );
    }

    if (apiError.retryAfter !== undefined) {
      void reply.header('Retry-After', String(apiError.retryAfter));
    }
    void reply.status(apiError.status).send(apiError.toBody());
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send(new ApiError('NOT_FOUND').toBody());
  });
}

export const errorHandlerPlugin = fp(plugin, { name: 'error-handler' });
