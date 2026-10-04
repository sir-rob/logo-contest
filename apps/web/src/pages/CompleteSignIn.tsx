/**
 * The landing route for an emailed sign-in link.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CROSS-DEVICE PATH IS THE WHOLE POINT OF THIS FILE.
 *
 * Firebase's `signInWithEmailLink` needs the address the link was issued to.
 * The SDK stashes it in `localStorage` on the device that requested it — so if
 * the link is opened anywhere else (phone instead of laptop, which is what
 * people actually do with email), that value is simply absent and sign-in dies
 * with `auth/invalid-email` or an empty screen.
 *
 * `pendingMagicLink()` tells us whether we have it. When we do not, we ASK.
 * Re-entering the address is safe: the link itself is the secret, and Firebase
 * verifies the two match. Skipping this prompt is the single most common way
 * email-link auth ships broken.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, LogIn, MailWarning } from 'lucide-react';
import { Button, Field, Input, Panel, Spinner } from '@/components/ui';
import { AuthLayout } from '@/components/AuthLayout';
import { pendingMagicLink, useAuth } from '@/auth/AuthProvider';
import { classifyAuthError, type AuthFailure } from '@/lib/auth-errors';
import { formatAllowedDomains, looksLikeEmail } from '@/lib/email-domain';
import { takeReturnTo } from '@/lib/return-to';

type Stage =
  /** Finishing sign-in with an address we already had. */
  | 'completing'
  /** Cross-device: the link is valid but we do not know whose it is. */
  | 'need-email'
  /** Consumed, expired, or superseded by a newer link. */
  | 'expired'
  /** Off-domain — the API refused the account. */
  | 'blocked'
  /** Not a magic link at all (someone bookmarked this URL). */
  | 'not-a-link'
  | 'error';

export function CompleteSignIn(): JSX.Element {
  const { status, completeLink } = useAuth();
  const navigate = useNavigate();

  // Read once. Completing sign-in mutates both the URL and localStorage, so
  // re-reading later would give a different — and misleading — answer.
  const [initial] = useState(() => pendingMagicLink());

  const [stage, setStage] = useState<Stage>(() => {
    if (!initial.isLink) return 'not-a-link';
    return initial.email ? 'completing' : 'need-email';
  });
  const [email, setEmail] = useState(initial.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  /**
   * The link is single-use. StrictMode mounts effects twice in development, and
   * a second attempt would consume nothing and report "expired" over a sign-in
   * that actually succeeded. Guard it.
   */
  const attempted = useRef(false);

  const complete = useCallback(
    async (address: string): Promise<void> => {
      setSubmitting(true);
      setFailure(null);
      try {
        await completeLink(address);
        // onAuthStateChanged fires next; the effect below does the navigating.
      } catch (err) {
        const classified = classifyAuthError(err);
        setFailure(classified);
        switch (classified.kind) {
          case 'link-expired':
            setStage('expired');
            break;
          case 'domain-not-allowed':
            setStage('blocked');
            break;
          case 'invalid-email':
            // Wrong address for this link — ask again rather than dead-ending.
            setStage('need-email');
            break;
          default:
            setStage('error');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [completeLink],
  );

  // Auto-complete when we already know the address.
  useEffect(() => {
    if (stage !== 'completing' || attempted.current) return;
    if (!initial.email) return;
    attempted.current = true;
    void complete(initial.email);
  }, [stage, initial.email, complete]);

  // Signed in — send them where they were originally headed.
  useEffect(() => {
    if (status === 'signed-in') navigate(takeReturnTo(), { replace: true });
  }, [status, navigate]);

  // Our API refused the account. `SignIn` owns that conversation.
  useEffect(() => {
    if (status === 'rejected') navigate('/signin', { replace: true });
  }, [status, navigate]);

  const goRequestNewLink = (): void => {
    navigate('/signin', { replace: true, state: email.trim() ? { email: email.trim() } : undefined });
  };

  // ---------------------------------------------------------------------
  // CROSS-DEVICE. Link opened somewhere other than where it was requested.
  // ---------------------------------------------------------------------
  if (stage === 'need-email') {
    const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!looksLikeEmail(email)) {
        setFailure({
          kind: 'invalid-email',
          message: 'Enter the address you asked for the link with.',
        });
        return;
      }
      attempted.current = true;
      void complete(email);
    };

    return (
      <AuthLayout
        title="Confirm your email"
        description="You opened this link on a different device or browser from the one you requested it on, so we need your address once more to finish signing you in."
      >
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="Email address"
            htmlFor="confirm-email"
            required
            hint={`The ${formatAllowedDomains()} address the link was sent to.`}
            error={failure?.kind === 'invalid-email' ? failure.message : undefined}
          >
            <Input
              id="confirm-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              spellCheck={false}
              value={email}
              disabled={submitting}
              onChange={(event) => {
                setEmail(event.target.value);
                if (failure) setFailure(null);
              }}
            />
          </Field>

          {failure && failure.kind !== 'invalid-email' ? <ErrorNotice message={failure.message} /> : null}

          <div className="mt-base">
            <Button type="submit" variant="primary" fullWidth loading={submitting} disabled={submitting}>
              <LogIn aria-hidden="true" className="mr-tight h-4 w-4" />
              Finish signing in
            </Button>
          </div>
        </form>

        <p className="mt-base text-xs text-ink-subtle">
          This is safe: the link in your email is the secret, and it only works with the address it
          was issued to.
        </p>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Used, expired, or replaced by a newer link.
  // ---------------------------------------------------------------------
  if (stage === 'expired') {
    return (
      <AuthLayout
        title="That link has expired"
        description="Sign-in links work once and last about an hour. If you requested more than one, only the newest works."
      >
        <p className="text-sm text-ink-muted">Getting a fresh one takes a few seconds.</p>
        <div className="mt-base">
          <Button variant="primary" onClick={goRequestNewLink}>
            Send me a new link
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Off-domain.
  // ---------------------------------------------------------------------
  if (stage === 'blocked') {
    return (
      <AuthLayout
        title={`This contest is for ${formatAllowedDomains()} addresses`}
        description={failure?.message}
      >
        <p className="text-sm text-ink-muted">
          The link was valid, but that address is not on the list for this contest. If you have a
          work address for this team, sign in with that instead.
        </p>
        <div className="mt-base">
          <Button variant="secondary" onClick={goRequestNewLink}>
            <ArrowLeft aria-hidden="true" className="mr-tight h-4 w-4" />
            Try a different address
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Somebody navigated here directly.
  // ---------------------------------------------------------------------
  if (stage === 'not-a-link') {
    return (
      <AuthLayout
        title="Nothing to finish here"
        description="This page completes a sign-in link from your inbox, and this does not look like one."
      >
        <div className="flex items-start gap-snug rounded border border-line bg-paper-sunken p-base">
          <MailWarning aria-hidden="true" className="mt-hair h-5 w-5 shrink-0 text-ink-subtle" />
          <p className="text-sm text-ink-muted">
            If you were trying to sign in, start from the sign-in page and we will email you a fresh
            link.
          </p>
        </div>
        <div className="mt-base">
          <Button variant="primary" onClick={goRequestNewLink}>
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (stage === 'error') {
    return (
      <AuthLayout title="We could not finish signing you in" description={failure?.message}>
        <div className="flex flex-wrap gap-snug">
          <Button variant="primary" onClick={goRequestNewLink}>
            Send me a new link
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              attempted.current = false;
              setStage(email ? 'completing' : 'need-email');
            }}
          >
            Try again
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Working. Never a blank screen.
  // ---------------------------------------------------------------------
  return (
    <AuthLayout title="Signing you in" description="One moment — we are verifying your link.">
      <div className="flex items-center gap-snug text-sm text-ink-muted">
        <Spinner label="Completing sign-in" />
        <span>Verifying…</span>
      </div>
    </AuthLayout>
  );
}

function ErrorNotice({ message }: { message: string }): JSX.Element {
  return (
    <Panel className="mt-base flex items-start gap-snug rounded border border-danger bg-danger-soft p-base">
      <AlertCircle aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-danger" />
      <p role="alert" className="text-sm text-ink">
        {message}
      </p>
    </Panel>
  );
}

export default CompleteSignIn;
