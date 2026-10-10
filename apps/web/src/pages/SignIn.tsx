/**
 * Sign in — email magic link, and nothing else.
 *
 * There is deliberately no Google button, no OAuth, no password. Corporate
 * @google.com accounts cannot authorise a third-party OAuth app and this is
 * Argolis-hosted, so a provider button would be a dead end that looks like the
 * primary path. One field, one action.
 *
 * The screen has four states and they are different *situations*, not
 * different severities of the same error:
 *
 *   form    — ask for the address
 *   sent    — we mailed a link; resend is throttled so nobody burns the
 *             server's 3-per-15-minutes allowance by clicking twice
 *   blocked — the address is off-domain. A wrong door, not a failure.
 *   rejected— Firebase let them in but our API will not. Same wrong door,
 *             except there is a live session to clear up.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Info, LogOut, Mail, MailCheck } from 'lucide-react';
import { Button, Field, Input, Panel } from '@/components/ui';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/auth/AuthProvider';
import { classifyAuthError, formatRetryAfter, type AuthFailure } from '@/lib/auth-errors';
import { domainHintFor, formatAllowedDomains, looksLikeEmail } from '@/lib/email-domain';
import { takeReturnTo } from '@/lib/return-to';

const CONTEST_CODE_STORAGE_KEY = 'n7.signin.contestCode';

function savePendingContestCode(code: string): void {
  try {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length > 0) {
      window.localStorage.setItem(CONTEST_CODE_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(CONTEST_CODE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

/** The server allows 3 links per 15 minutes. 60s between clicks keeps people well inside that. */
const RESEND_COOLDOWN_SECONDS = 60;

type Stage = 'form' | 'sent' | 'blocked';

interface SignInLocationState {
  /** Carried over from the expired-link screen so the field is already filled. */
  email?: string;
}

const formatClock = (totalSeconds: number): string => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Counts down once a second. Returns the remaining seconds and a way to (re)start. */
function useCooldown(): [number, (seconds: number) => void] {
  const [until, setUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (until === null) return;
    const update = (): void => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setUntil(null);
    };
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [until]);

  const start = useCallback((seconds: number) => {
    setUntil(Date.now() + seconds * 1000);
    setRemaining(seconds);
  }, []);

  return [remaining, start];
}

export function SignIn(): JSX.Element {
  const { status, rejectionReason, requestLink, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as SignInLocationState | null)?.email ?? '';

  const [email, setEmail] = useState(prefill);
  const [contestCode, setContestCode] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [sentTo, setSentTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [cooldown, startCooldown] = useCooldown();
  const wasCoolingDown = useRef(false);

  // Already signed in — go where they were headed rather than showing a form
  // they do not need.
  useEffect(() => {
    if (status === 'signed-in') navigate(takeReturnTo(), { replace: true });
  }, [status, navigate]);

  useEffect(() => {
    if (cooldown > 0) wasCoolingDown.current = true;
  }, [cooldown]);

  const send = useCallback(
    async (address: string): Promise<void> => {
      setSubmitting(true);
      setFailure(null);
      try {
        savePendingContestCode(contestCode);
        await requestLink(address);
        setSentTo(address.trim().toLowerCase());
        setStage('sent');
        startCooldown(RESEND_COOLDOWN_SECONDS);
      } catch (err) {
        const classified = classifyAuthError(err);
        setFailure(classified);

        if (classified.kind === 'domain-not-allowed') {
          setStage('blocked');
        } else if (classified.kind === 'rate-limited') {
          // No mail was generated, so staying put is honest. The cooldown is
          // set from the server's own retry-after when it gave us one.
          startCooldown(classified.retryAfter ?? RESEND_COOLDOWN_SECONDS);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [contestCode, requestLink, startCooldown],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setFailure({ kind: 'invalid-email', message: 'Enter an email address so we know where to send the link.' });
      return;
    }
    void send(email);
  };

  // ---------------------------------------------------------------------
  // Signed in to Firebase, refused by our API. Same wrong door, live session.
  // ---------------------------------------------------------------------
  if (status === 'rejected') {
    return (
      <AuthLayout
        title={`This contest is for ${formatAllowedDomains()} addresses`}
        description={
          rejectionReason ??
          'Your address was verified, but it is not on the list for this contest.'
        }
      >
        <p className="text-sm text-ink-muted">
          Nothing is wrong on your end — the entrant list is limited to the team running the
          contest. If you think that is a mistake, ask the contest admin to add you.
        </p>
        <div className="mt-base">
          <Button
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            <LogOut aria-hidden="true" className="mr-tight h-4 w-4" />
            Sign out and try another address
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Off-domain. Calm and explanatory — this person took a wrong turn, they
  // did not break anything.
  // ---------------------------------------------------------------------
  if (stage === 'blocked') {
    return (
      <AuthLayout
        title={`This contest is for ${formatAllowedDomains()} addresses`}
        description={failure?.message}
      >
        <p className="text-sm text-ink-muted">
          We did not send a link to <span className="font-medium text-ink">{email.trim()}</span>.
          If you have a work address for this team, use that one instead.
        </p>
        <div className="mt-base">
          <Button
            variant="secondary"
            onClick={() => {
              setStage('form');
              setFailure(null);
              setEmail('');
            }}
          >
            <ArrowLeft aria-hidden="true" className="mr-tight h-4 w-4" />
            Try a different address
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // Link sent. The whole job of this screen is to stop people clicking again.
  // ---------------------------------------------------------------------
  if (stage === 'sent') {
    const throttled = cooldown > 0;
    return (
      <AuthLayout
        title="Check your inbox"
        description={
          <>
            We sent a sign-in link to <span className="font-medium text-ink">{sentTo}</span>.
          </>
        }
      >
        <div className="flex items-start gap-snug rounded border border-line bg-paper-sunken p-base">
          <MailCheck aria-hidden="true" className="mt-hair h-5 w-5 shrink-0 text-ink-subtle" />
          <p className="text-sm text-ink-muted">
            Open it on any device and you will be signed in. The link works once and expires after
            an hour. Delivery usually takes under a minute — check spam if it has not arrived.
          </p>
        </div>

        {failure?.kind === 'rate-limited' ? (
          <RateLimitNotice failure={failure} />
        ) : failure ? (
          <ErrorNotice message={failure.message} />
        ) : null}

        <div className="mt-base flex flex-wrap items-center gap-snug">
          <Button
            variant="secondary"
            disabled={throttled || submitting}
            loading={submitting}
            onClick={() => {
              void send(sentTo);
            }}
          >
            <Mail aria-hidden="true" className="mr-tight h-4 w-4" />
            Send another link
          </Button>

          <Button
            variant="ghost"
            onClick={() => {
              setStage('form');
              setFailure(null);
            }}
          >
            Use a different address
          </Button>
        </div>

        {/* Visible timer for sighted users... */}
        {throttled ? (
          <p aria-hidden="true" className="mt-snug text-xs text-ink-subtle">
            You can resend in {formatClock(cooldown)}
          </p>
        ) : null}

        {/* ...and a single announcement when it lifts, rather than a screen
            reader reading a new number every second. */}
        <p aria-live="polite" className="sr-only">
          {!throttled && wasCoolingDown.current ? 'You can request another link now.' : ''}
        </p>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------------
  // The form.
  // ---------------------------------------------------------------------
  const hint = domainHintFor(email);
  const fieldError = failure?.kind === 'invalid-email' ? failure.message : undefined;

  return (
    <AuthLayout
      title="Sign in"
      description="Enter your email address and we will send you a link that signs you in. No password to remember."
      footer={
        <p>
          Entries are anonymous. Sign-in only tells us you are on the team — it is never attached to
          your entry or your ballot.
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email address"
          htmlFor="signin-email"
          required
          hint={hint ?? `Use your ${formatAllowedDomains()} address.`}
          error={fieldError}
        >
          <Input
            id="signin-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            spellCheck={false}
            placeholder={`you${formatAllowedDomains().split(' or ')[0] ?? ''}`}
            value={email}
            disabled={submitting}
            onChange={(event) => {
              setEmail(event.target.value);
              if (failure) setFailure(null);
            }}
          />
        </Field>

        <div className="mt-base">
          <Field
            label="Contest code"
            htmlFor="signin-contest-code"
            hint="If an organizer shared a contest code with you, enter it here to register automatically."
          >
            <Input
              id="signin-contest-code"
              name="contestCode"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. NORTH7"
              value={contestCode}
              disabled={submitting}
              onChange={(event) => {
                setContestCode(event.target.value.toUpperCase());
              }}
            />
          </Field>
        </div>

        {failure?.kind === 'rate-limited' ? (
          <RateLimitNotice failure={failure} />
        ) : failure && failure.kind !== 'invalid-email' ? (
          <ErrorNotice message={failure.message} />
        ) : null}

        <div className="mt-base">
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={submitting}
            disabled={submitting || cooldown > 0}
          >
            <Mail aria-hidden="true" className="mr-tight h-4 w-4" />
            Email me a sign-in link
          </Button>
        </div>

        {cooldown > 0 ? (
          <p aria-hidden="true" className="mt-snug text-center text-xs text-ink-subtle">
            You can try again in {formatClock(cooldown)}
          </p>
        ) : null}
      </form>
    </AuthLayout>
  );
}

/**
 * Being rate-limited is not an error — it is the system working. Neutral
 * styling, because a red box here makes people think they are locked out.
 */
function RateLimitNotice({ failure }: { failure: AuthFailure }): JSX.Element {
  return (
    <Panel className="mt-base flex items-start gap-snug rounded border border-line bg-paper-sunken p-base">
      <Info aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-ink-subtle" />
      <p className="text-sm text-ink-muted">
        You have requested a few links already. You can ask for another{' '}
        {formatRetryAfter(failure.retryAfter)}. The most recent link we sent should still work —
        it is worth checking your inbox first.
      </p>
    </Panel>
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

export default SignIn;
