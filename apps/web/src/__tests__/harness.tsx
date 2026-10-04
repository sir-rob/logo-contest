/**
 * Shared rendering plumbing for the web suite.
 *
 * Deliberately thin. Every test still says out loud which API calls it is
 * standing in for, because a helper that silently supplies a happy-path
 * response is how a suite ends up asserting against a fixture instead of
 * against the app.
 */

import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A retrying query turns a one-line failure assertion into a four-second
      // timeout, and hides which call actually failed.
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  /** Initial router entry. Defaults to `/`. */
  route?: string;
  queryClient?: QueryClient;
}

export type RenderWithProviders = RenderResult & { queryClient: QueryClient };

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = makeQueryClient() }: RenderOptions = {},
): RenderWithProviders {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  // Object.assign, not a spread: RenderResult's bound queries come from a
  // mapped type that does not survive being spread into a fresh object
  // literal, and TS then reports 40-odd missing members.
  return Object.assign(render(ui, { wrapper }), { queryClient });
}

/** Every email-looking string in the rendered DOM, attributes included. */
export function emailsInDom(root: HTMLElement = document.body): string[] {
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const found = new Set<string>();

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const m of (node.textContent ?? '').matchAll(pattern)) found.add(m[0]);
      return;
    }
    if (node instanceof Element) {
      for (const attr of Array.from(node.attributes)) {
        for (const m of attr.value.matchAll(pattern)) found.add(m[0]);
      }
      for (const child of Array.from(node.childNodes)) visit(child);
    }
  };

  visit(root);
  return [...found];
}

/** A File whose `size` and `type` are whatever the test needs them to be. */
export function makeFile(
  name: string,
  type: string,
  sizeBytes: number,
  contents = 'x',
): File {
  const file = new File([contents], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}
