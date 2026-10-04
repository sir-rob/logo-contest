/**
 * Sign-in, end to end through the UI.
 *
 * These run the REAL `AuthProvider`, not a stubbed context. Firebase and the
 * API client are mocked at the module boundary, which leaves the whole of
 * `requestLink` / `completeLink` / `pendingMagicLink` / `classifyAuthError`
 * under test. Stubbing `useAuth` instead would have made every one of these
 * assertions a test of the stub.
 *
 * The cross-device case (`need-email`) is the one that matters most. It is the
 * most common way email-link auth ships broken: the address Firebase needs
 * lives in localStorage on the device that ASKED for the link, and people open
 * their mail on a phone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase', () => ({
  getFirebaseAuth: vi.fn(() => ({ currentUser: null })),
  sendMagicLink: vi.fn(async () => undefined),
  completeMagicLink: vi.fn(async () => ({})),
  isMagicLink: vi.fn(() => false),
  recallSignInEmail: vi.fn(() => null),
  rememberSignInEmail: vi.fn(),
  forgetSignInEmail: vi.fn(),
  signOutUser: vi.fn(async () => undefined),
  currentIdToken: vi.fn(async () => null),
  appUrl: 'http://localhost',
  useEmulators: false,
  firebaseConfig: {},
  getFirebase: vi.fn(() => ({})),
}));

// The provider subscribes on mount. Fire "signed out" immediately so the tree
// settles instead of sitting on the loading spinner forever.
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb(null);
    return () => undefined;
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      requestMagicLink: vi.fn(async () => undefined),
      me: vi.fn(async () => {
        throw new Error('not signed in');
      }),
    },
  };
});

import { api, ApiClientError } from '@/lib/api';
import * as firebase from '@/lib/firebase';
import { AuthProvider } from '@/auth/AuthProvider';
import { SignIn } from '@/pages/SignIn';
import { CompleteSignIn } from '@/pages/CompleteSignIn';
import { renderWithProviders } from './harness';

const mockApi = vi.mocked(api, true) as unknown as {
  requestMagicLink: ReturnType<typeof vi.fn>;
};
const mockFirebase = vi.mocked(firebase, true);

const renderSignIn = (): void => {
  renderWithProviders(
    <AuthProvider>
      <SignIn />
    </AuthProvider>,
    { route: '/signin' },
  );
};

const renderCompleteSignIn = (): void => {
  renderWithProviders(
    <AuthProvider>
      <CompleteSignIn />
    </AuthProvider>,
    { route: '/finish-sign-in' },
  );
};

beforeEach(() => {
  mockApi.requestMagicLink.mockReset().mockResolvedValue(undefined);
  mockFirebase.sendMagicLink.mockReset().mockResolvedValue(undefined);
  mockFirebase.completeMagicLink.mockReset().mockResolvedValue({} as never);
  mockFirebase.isMagicLink.mockReset().mockReturnValue(false);
  mockFirebase.recallSignInEmail.mockReset().mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sign-in — off-domain address', () => {
  it('warns before submit that the contest is limited to the allowed domain', async () => {
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'someone@gmail.com');

    // Calm, informative, and it does not block the attempt — the server owns
    // the allowlist, this is only a hint.
    expect(
      screen.getByText(/this contest is for @google\.com addresses/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeEnabled();
  });

  it('shows the wrong-door page and never pretends a link was sent', async () => {
    const user = userEvent.setup();
    mockApi.requestMagicLink.mockRejectedValue(
      new ApiClientError(
        'AUTH_DOMAIN_NOT_ALLOWED',
        'This contest is limited to @google.com addresses.',
        403,
      ),
    );

    renderSignIn();
    await user.type(screen.getByLabelText(/email address/i), 'someone@gmail.com');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await screen.findByText(/this contest is limited to @google\.com addresses\./i);

    // Explicitly NOT the "check your inbox" state.
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
    expect(screen.getByText(/we did not send a link to/i)).toBeInTheDocument();

    // And nothing was actually mailed: the API is asked first, precisely so an
    // off-domain address never reaches the mail queue.
    expect(mockFirebase.sendMagicLink).not.toHaveBeenCalled();

    // Not dressed as a crash — there is a way onward.
    expect(screen.getByRole('button', { name: /try a different address/i })).toBeInTheDocument();
  });
});

describe('sign-in — link sent', () => {
  it('names the address and throttles resend on a visible timer', async () => {
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'viewer@google.com');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await screen.findByText(/check your inbox/i);

    // The address is named, so a typo is discoverable without going back.
    expect(screen.getByText('viewer@google.com')).toBeInTheDocument();
    expect(mockFirebase.sendMagicLink).toHaveBeenCalledWith('viewer@google.com');

    const resend = screen.getByRole('button', { name: /send another link/i });
    expect(resend).toBeDisabled();
    expect(screen.getByText(/you can resend in 1:00/i)).toBeInTheDocument();
  });

  it('lowercases and trims the address it reports back', async () => {
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), '  Viewer@Google.com  ');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await screen.findByText(/check your inbox/i);
    expect(screen.getByText('viewer@google.com')).toBeInTheDocument();
  });
});

describe('sign-in — completion, cross-device', () => {
  /**
   * THE HIGH-VALUE ONE.
   *
   * A valid magic link, opened on a device that never stored the address.
   * The screen must ASK rather than fail with `auth/invalid-email` or a blank
   * page — and it must not silently try to complete with an empty address.
   */
  it('prompts for the address when localStorage has no pending email', async () => {
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue(null);

    renderCompleteSignIn();

    expect(await screen.findByRole('heading', { name: /confirm your email/i })).toBeInTheDocument();
    expect(
      screen.getByText(/opened this link on a different device or browser/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();

    // Critically: no attempt was made with a blank address.
    expect(mockFirebase.completeMagicLink).not.toHaveBeenCalled();
  });

  it('completes sign-in once the address is supplied by hand', async () => {
    const user = userEvent.setup();
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue(null);

    renderCompleteSignIn();

    await user.type(await screen.findByLabelText(/email address/i), 'viewer@google.com');
    await user.click(screen.getByRole('button', { name: /finish signing in/i }));

    await waitFor(() => {
      expect(mockFirebase.completeMagicLink).toHaveBeenCalledWith('viewer@google.com');
    });
  });

  it('rejects a malformed address inline rather than dead-ending', async () => {
    const user = userEvent.setup();
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue(null);

    renderCompleteSignIn();

    await user.type(await screen.findByLabelText(/email address/i), 'not-an-address');
    await user.click(screen.getByRole('button', { name: /finish signing in/i }));

    expect(
      await screen.findByText(/enter the address you asked for the link with/i),
    ).toBeInTheDocument();
    expect(mockFirebase.completeMagicLink).not.toHaveBeenCalled();
  });

  it('auto-completes without prompting when the address IS stored', async () => {
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue('viewer@google.com');

    renderCompleteSignIn();

    await waitFor(() => {
      expect(mockFirebase.completeMagicLink).toHaveBeenCalledWith('viewer@google.com');
    });
    expect(screen.queryByRole('heading', { name: /confirm your email/i })).not.toBeInTheDocument();
  });
});

describe('sign-in — expired or already-used link', () => {
  it('offers a one-click resend', async () => {
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue('viewer@google.com');
    mockFirebase.completeMagicLink.mockRejectedValue(
      Object.assign(new Error('expired'), { code: 'auth/invalid-action-code' }),
    );

    renderCompleteSignIn();

    expect(await screen.findByRole('heading', { name: /that link has expired/i })).toBeInTheDocument();

    const resend = screen.getByRole('button', { name: /send me a new link/i });
    expect(resend).toBeEnabled();

    // One click, no re-typing: the address is carried to the sign-in screen.
    expect(screen.getByText(/sign-in links work once/i)).toBeInTheDocument();
  });

  it('treats a link that Firebase says is already consumed the same way', async () => {
    mockFirebase.isMagicLink.mockReturnValue(true);
    mockFirebase.recallSignInEmail.mockReturnValue('viewer@google.com');
    mockFirebase.completeMagicLink.mockRejectedValue(
      Object.assign(new Error('expired'), { code: 'auth/expired-action-code' }),
    );

    renderCompleteSignIn();

    expect(await screen.findByRole('heading', { name: /that link has expired/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send me a new link/i })).toBeInTheDocument();
  });
});
