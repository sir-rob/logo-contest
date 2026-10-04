/**
 * Browser entry point.
 *
 * Provider order is load-bearing: React Query sits inside AuthProvider so that
 * a sign-out can clear the cache.
 *
 * The `<Toaster />` now lives in `App.tsx` alongside the error boundary —
 * mounting a second one here would render every toast twice.
 *
 * There is no theme provider: the accent lives in `useAccent` inside the design
 * system's `accent-toggle`, which manages the `data-accent` attribute itself.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { createQueryClient } from './lib/query-client';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';

const queryClient = createQueryClient();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    {/* Last resort: catches a throw from the providers themselves, which the
        route-level boundary inside App is mounted too deep to see. */}
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
