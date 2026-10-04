/**
 * Top-level error boundary.
 *
 * A render crash inside React unmounts the whole tree and leaves a white page.
 * On a contest with a deadline, a white page reads as "the site is down" and
 * people stop trying — so the floor here is: always something on screen, always
 * a way forward.
 *
 * Deliberately a class: `componentDidCatch` has no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { CONTEST_NAME } from '@/lib/branding';

interface Props {
  children: ReactNode;
  /** Remounting the subtree resets the boundary; changing this does too. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry endpoint in v1, so the console is the trail. Keeping the
    // component stack matters — the message alone rarely locates the fault.
    console.error('Unhandled error in render:', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    // A navigation usually makes the failing subtree irrelevant. Clearing on
    // route change stops one bad page from swallowing the rest of the app.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col bg-paper px-base py-loose">
        <main className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center">
          <p className="mb-snug text-label uppercase text-ink-subtle">{CONTEST_NAME}</p>

          <Panel className="rounded border border-line bg-paper-raised p-roomy">
            <div className="flex items-start gap-snug">
              <AlertTriangle aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-danger" />
              <div>
                <h1 className="font-display text-display-sm text-ink">Something broke on this page</h1>
                <p className="mt-snug text-sm text-ink-muted">
                  That is our fault, not yours. Nothing you had already saved — your entry, your
                  ballot — is affected; both live on the server, not in this page.
                </p>
              </div>
            </div>

            <div className="mt-base flex flex-wrap gap-snug">
              <Button variant="primary" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => window.location.assign('/')}>
                Reload the app
              </Button>
            </div>

            <details className="mt-base border-t border-line pt-base">
              <summary className="cursor-pointer text-sm text-ink-muted">
                Technical detail
              </summary>
              <pre className="mt-snug overflow-x-auto whitespace-pre-wrap break-words text-xs text-ink-subtle">
                {error.message}
              </pre>
            </details>
          </Panel>
        </main>
      </div>
    );
  }
}

export default ErrorBoundary;
