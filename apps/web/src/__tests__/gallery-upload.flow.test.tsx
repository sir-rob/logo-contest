/**
 * Gallery and upload.
 *
 * The anonymity assertions here are deliberately blunt: rather than checking
 * that a particular label is absent, they sweep the ENTIRE rendered DOM —
 * text and attributes — for anything shaped like an email address or an owner
 * field. A targeted assertion only catches the leak you already thought of.
 *
 * Anonymity in this app is structural: `PublicSubmissionDto` has no uploader
 * field, so there is nothing to render. These tests exist to notice the day
 * that stops being true.
 */

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_UPLOAD_BYTES } from '@contest/shared';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      contest: vi.fn(),
      submissions: vi.fn(),
      me: vi.fn(),
      upsertSubmission: vi.fn(),
      updateSubmissionMeta: vi.fn(),
      withdrawSubmission: vi.fn(),
    },
  };
});

import { api } from '@/lib/api';
import { Gallery } from '@/pages/Gallery';
import { MyEntry } from '@/pages/MyEntry';
import { UploadDropzone } from '@/components/UploadDropzone';
import type { ImageRejection } from '@/lib/image-validation';
import { ENTRIES, makeContestInPhase, makeEntry, makeMe } from './fixtures';
import { emailsInDom, makeFile, renderWithProviders } from './harness';

const mockApi = vi.mocked(api, { deep: true });

beforeEach(() => {
  mockApi.contest.mockReset().mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
  mockApi.submissions.mockReset().mockResolvedValue(ENTRIES);
  mockApi.me.mockReset().mockResolvedValue(makeMe());
  mockApi.upsertSubmission.mockReset().mockResolvedValue(makeEntry('e3', { isMine: true }));
  mockApi.withdrawSubmission.mockReset().mockResolvedValue(undefined);
});

describe('gallery — anonymity', () => {
  it('renders no email address anywhere in the DOM', async () => {
    renderWithProviders(<Gallery />, { route: '/gallery' });
    await screen.findByRole('button', { name: /entry 01/i });

    expect(emailsInDom()).toEqual([]);
  });

  it('renders no uploader, owner or author field for other people’s entries', async () => {
    renderWithProviders(<Gallery />, { route: '/gallery' });
    await screen.findByRole('button', { name: /entry 01/i });

    const text = document.body.textContent ?? '';
    for (const word of [/uploaded by/i, /submitted by/i, /owner/i, /author/i, /created by/i]) {
      expect(text).not.toMatch(word);
    }

    // Nor smuggled through an attribute (title=, alt=, data-*).
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/uploader/i);
    expect(html).not.toMatch(/\buid\b/i);
  });

  it('marks only the viewer’s own entry as theirs', async () => {
    renderWithProviders(<Gallery />, { route: '/gallery' });
    await screen.findByRole('button', { name: /entry 01/i });

    // Exactly one "Yours" badge, and it is on e3 — the only isMine entry.
    const badges = screen.getAllByText('Yours');
    expect(badges).toHaveLength(1);

    const ownTile = screen.getByRole('button', { name: /entry 03.*your entry/i });
    expect(within(ownTile).getByText('Yours')).toBeInTheDocument();

    // Everyone else's tile says nothing about who made it.
    const otherTile = screen.getByRole('button', { name: /^entry 01/i });
    expect(within(otherTile).queryByText('Yours')).toBeNull();
  });

  it('does not reveal ownership through the accessible name of other tiles', async () => {
    renderWithProviders(<Gallery />, { route: '/gallery' });
    await screen.findByRole('button', { name: /entry 01/i });

    const tiles = screen.getAllByRole('button', { name: /open larger view/i });
    const named = tiles
      .map((t) => t.getAttribute('aria-label') ?? '')
      .filter((label) => /your entry/i.test(label));

    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/entry 03/i);
  });
});

describe('upload — client-side validation, before anything is sent', () => {
  /**
   * The dropzone is controlled — it reports a rejection upward and renders
   * whatever it is handed back. This little stateful wrapper closes that loop
   * so the message under test is the one a real screen would display.
   */
  const renderDropzone = (
    onAccepted: ReturnType<typeof vi.fn>,
    onRejected: ReturnType<typeof vi.fn>,
  ): void => {
    function Harness(): JSX.Element {
      const [rejection, setRejection] = useState<ImageRejection | null>(null);
      return (
        <UploadDropzone
          rejection={rejection}
          onAccepted={onAccepted}
          onRejected={(r) => {
            onRejected(r);
            setRejection(r);
          }}
        />
      );
    }
    renderWithProviders(<Harness />);
  };

  /** Drag a file onto the dropzone label, the way a person actually would. */
  const dropFile = (file: File): void => {
    const label = document.querySelector('label[for]') as HTMLElement;
    fireEvent.drop(label, { dataTransfer: { files: [file], types: ['Files'] } });
  };

  it('rejects an SVG with a plain-language reason and no upload attempt', async () => {
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    renderDropzone(onAccepted, onRejected);

    // Dropped, not picked. The file input carries an `accept` filter that the
    // OS dialog (and user-event) honours, so the picker cannot deliver an SVG
    // at all — but a DRAG bypasses `accept` in every real browser. Drop is
    // therefore the channel by which a disallowed type actually arrives, and
    // the one the validation has to survive.
    dropFile(makeFile('logo.svg', 'image/svg+xml', 4096));

    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    const rejection = onRejected.mock.calls[0]?.[0] as ImageRejection;

    expect(rejection.reason).toBe('type');
    expect(rejection.message).toMatch(/svg/i);
    // Says what to do next, not just what was wrong.
    expect(rejection.message).toMatch(/png|jpeg|webp/i);

    expect(onAccepted).not.toHaveBeenCalled();
    expect(mockApi.upsertSubmission).not.toHaveBeenCalled();
  });

  it('rejects a PDF by pointing at a flat image export', async () => {
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    renderDropzone(onAccepted, onRejected);

    dropFile(makeFile('logo.pdf', 'application/pdf', 4096));

    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    expect((onRejected.mock.calls[0]?.[0] as ImageRejection).message).toMatch(/pdf/i);
    expect(mockApi.upsertSubmission).not.toHaveBeenCalled();
  });

  it('rejects an oversized file in human units, without decoding it', async () => {
    const user = userEvent.setup();
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);

    renderDropzone(onAccepted, onRejected);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile('huge.png', 'image/png', MAX_UPLOAD_BYTES + 1));

    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    const rejection = onRejected.mock.calls[0]?.[0] as ImageRejection;

    expect(rejection.reason).toBe('file-too-large');
    expect(rejection.message).toMatch(/MB/);
    // Cheapest check first: an obviously-too-big file is never decoded.
    expect(decode).not.toHaveBeenCalled();
    expect(mockApi.upsertSubmission).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('rejects an undersized image and says how small it was', async () => {
    const user = userEvent.setup();
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 300, height: 300, close: () => undefined })),
    );

    renderDropzone(onAccepted, onRejected);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile('small.png', 'image/png', 50_000));

    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    const rejection = onRejected.mock.calls[0]?.[0] as ImageRejection;

    expect(rejection.reason).toBe('dimensions-too-small');
    expect(rejection.message).toMatch(/300/);
    expect(rejection.message).toMatch(/512/);

    expect(onAccepted).not.toHaveBeenCalled();
    expect(mockApi.upsertSubmission).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('accepts a good file and reports its dimensions', async () => {
    const user = userEvent.setup();
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1024, height: 1024, close: () => undefined })),
    );

    renderDropzone(onAccepted, onRejected);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile('logo.png', 'image/png', 80_000));

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(onAccepted.mock.calls[0]?.[0]).toMatchObject({ width: 1024, height: 1024 });
    expect(onRejected).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('announces the rejection rather than only showing it', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <UploadDropzone
        rejection={{ reason: 'type', message: 'SVG is not accepted. Export a PNG.' }}
        onAccepted={vi.fn()}
        onRejected={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/svg is not accepted/i);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    await user.tab();
  });
});

describe('upload — after the deadline', () => {
  it('removes the upload, replace and withdraw controls and explains why', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
    mockApi.me.mockResolvedValue(
      makeMe({ mySubmission: makeEntry('e3', { isMine: true, title: 'My mark' }) }),
    );

    renderWithProviders(<MyEntry />, { route: '/submit' });

    // The locked explanation, not a dead form.
    expect(await screen.findByText(/your entry is in/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the deadline has passed.*can no longer be replaced or withdrawn/i),
    ).toBeInTheDocument();

    // Every mutating control is GONE, not disabled.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /replace/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();

    // And it says what happens next instead of leaving a dead end.
    expect(screen.getByText(/what happens next/i)).toBeInTheDocument();
  });

  it('still reassures someone who never entered', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
    mockApi.me.mockResolvedValue(makeMe({ mySubmission: null }));

    renderWithProviders(<MyEntry />, { route: '/submit' });

    // The phrase appears twice — as the page description and as the locked
    // panel's heading. The heading is the one that matters here.
    expect(
      await screen.findByRole('heading', { name: /submissions are closed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/you can still vote/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('offers the upload control while submissions are open', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('SUBMISSIONS_OPEN'));
    mockApi.me.mockResolvedValue(makeMe({ mySubmission: null }));

    renderWithProviders(<MyEntry />, { route: '/submit' });

    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    expect(screen.queryByText(/the deadline has passed/i)).toBeNull();
  });
});
