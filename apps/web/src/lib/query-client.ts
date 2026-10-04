/**
 * React Query configuration.
 *
 * Contest data is small and changes on human timescales, so the defaults lean
 * conservative. The two exceptions live at their call sites: the dashboard
 * polls while voting is open, and anything auth-shaped is never retried
 * (retrying a 401 just burns three round trips before showing the same
 * sign-in prompt).
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api';

export const queryKeys = {
  me: ['me'] as const,
  contest: ['contest'] as const,
  submissions: ['submissions'] as const,
  ballot: ['ballot'] as const,
  dashboard: ['dashboard'] as const,
  results: ['results'] as const,
  admin: {
    moderation: ['admin', 'moderation'] as const,
    turnout: ['admin', 'turnout'] as const,
    audit: ['admin', 'audit'] as const,
  },
} as const;

/** Retry transient failures only. A 4xx will fail identically next time. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError) {
    if (error.isAuthProblem) return false;
    if (error.status >= 400 && error.status < 500 && error.status !== 429) return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Polling interval for live standings while voting is open. */
export const LIVE_POLL_MS = 15_000;
