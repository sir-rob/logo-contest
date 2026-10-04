/**
 * Does the jsdom harness actually work?
 *
 * If this fails, nothing else in the suite can be trusted — so it is kept
 * tiny and dependency-free rather than folded into a real flow test.
 */

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Button, EmptyState } from '@/components/ui';
import { renderWithProviders, emailsInDom } from './harness';

describe('web test harness', () => {
  it('renders a design-system component into jsdom', () => {
    renderWithProviders(<Button>Press me</Button>);
    expect(screen.getByRole('button', { name: 'Press me' })).toBeInTheDocument();
  });

  it('renders an EmptyState with a rendered icon element', () => {
    renderWithProviders(
      <EmptyState title="Nothing here" description="Yet." icon={<span data-testid="icon" />} />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('emailsInDom finds addresses in text and in attributes', () => {
    renderWithProviders(
      <div>
        <span title="hidden@example.com">visible@example.com</span>
      </div>,
    );
    expect(emailsInDom().sort()).toEqual(['hidden@example.com', 'visible@example.com']);
  });
});
