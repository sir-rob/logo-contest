/**
 * "Your entry" — the whole upload flow.
 *
 * Three states, decided by the phase and by whether the person already has an
 * entry:
 *
 *   1. Submissions open, no entry   → the upload form.
 *   2. Submissions open, has entry  → the entry, plus replace / edit / withdraw.
 *   3. Submissions closed           → a calm locked view with what happens next.
 *
 * State 3 hides the controls rather than disabling them. A greyed-out button
 * with no explanation is a worse answer than no button and a sentence. The
 * server can also close submissions between render and request, so
 * `PHASE_SUBMISSIONS_CLOSED` coming back from any mutation flips this screen
 * into the same locked state instead of surfacing a generic failure.
 *
 * One entry per person is a rule, not a hint: there is no "add another". A new
 * file replaces the old one, and the UI says so before the person commits.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Info, Lock, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  canSubmit,
  type PublicSubmissionDto,
} from '@contest/shared';
import { api } from '@/lib/api';
import { EmptyEntryFrame, EntryFrame } from '@/components/EntryFrame';
import { UploadDropzone } from '@/components/UploadDropzone';
import { describeSubmissionFailure, type SubmissionFailure } from '@/lib/submission-errors';
import type { AcceptedImage, ImageRejection } from '@/lib/image-validation';
import { entryAlt } from '@/lib/entry-labels';
import { cn } from '@/lib/utils';
import {
  Button,
  CharCount,
  ConfirmDialog,
  Countdown,
  Divider,
  Field,
  Input,
  Label,
  PageHeader,
  Panel,
  PanelHeader,
  Skeleton,
  Textarea,
} from '@/components/ui';

export function MyEntry(): JSX.Element {
  const queryClient = useQueryClient();

  const contestQuery = useQuery({ queryKey: ['contest'], queryFn: api.contest });
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me });

  /**
   * Set when the server tells us the deadline passed. Trusted over the local
   * phase immediately — the server's clock is the one that counts, and waiting
   * for a refetch would leave live controls on screen for another second.
   */
  const [serverClosed, setServerClosed] = useState(false);

  const contest = contestQuery.data;
  const mine = meQuery.data?.mySubmission ?? null;
  const open = contest ? canSubmit(contest.phase) && !serverClosed : false;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['submissions'] });
  }, [queryClient]);

  const handlePhaseClosed = useCallback(() => {
    setServerClosed(true);
    void queryClient.invalidateQueries({ queryKey: ['contest'] });
    invalidate();
  }, [invalidate, queryClient]);

  if (contestQuery.isPending || meQuery.isPending) return <MyEntrySkeleton />;

  if (contestQuery.isError || meQuery.isError) {
    return (
      <div className="space-y-loose">
        <PageHeader eyebrow="Media Moguls · North 7" title="Your entry" />
        <Panel>
          <div className="space-y-4 p-roomy">
            <p className="flex items-start gap-2 text-sm text-ink">
              <RefreshCw aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-ink-subtle" />
              <span>
                Could not load your entry. Nothing has changed — whatever you submitted before is still
                there.
              </span>
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                void contestQuery.refetch();
                void meQuery.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-loose">
      <PageHeader
        eyebrow="Media Moguls · North 7"
        title="Your entry"
        description={
          open
            ? 'One logo per person. Nobody sees who uploaded what — not while voting, not after.'
            : 'Submissions are closed.'
        }
      />

      {open ? (
        <OpenState
          mine={mine}
          submissionsCloseAt={contest?.submissionsCloseAt ?? null}
          serverNow={contest?.serverNow ?? null}
          onChanged={invalidate}
          onPhaseClosed={handlePhaseClosed}
        />
      ) : (
        <LockedState mine={mine} contest={contest ?? null} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Submissions open                                                            */
/* -------------------------------------------------------------------------- */

function OpenState({
  mine,
  submissionsCloseAt,
  serverNow,
  onChanged,
  onPhaseClosed,
}: {
  mine: PublicSubmissionDto | null;
  submissionsCloseAt: string | null;
  serverNow: string | null;
  onChanged: () => void;
  onPhaseClosed: () => void;
}): JSX.Element {
  return (
    <div className="grid gap-loose lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <EntryForm
        mine={mine}
        onChanged={onChanged}
        onPhaseClosed={onPhaseClosed}
      />

      <aside className="space-y-roomy">
        {submissionsCloseAt && serverNow ? (
          <Panel>
            <div className="space-y-2 p-roomy">
              <p className="eyebrow">Submissions close in</p>
              <Countdown to={submissionsCloseAt} serverNow={serverNow} />
              <p className="text-xs text-ink-muted">
                You can replace or withdraw your entry freely until then. After that the entry you have
                uploaded is the one that goes to the vote.
              </p>
            </div>
          </Panel>
        ) : null}

        {mine ? (
          <Panel>
            <PanelHeader
              eyebrow="Withdraw"
              title="Take your entry out"
              description="Removes it from the contest entirely. You can upload a new one any time before the deadline."
            />
            <div className="p-roomy pt-0">
              <WithdrawControl id={mine.id} onChanged={onChanged} onPhaseClosed={onPhaseClosed} />
            </div>
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

function EntryForm({
  mine,
  onChanged,
  onPhaseClosed,
}: {
  mine: PublicSubmissionDto | null;
  onChanged: () => void;
  onPhaseClosed: () => void;
}): JSX.Element {
  const [staged, setStaged] = useState<AcceptedImage | null>(null);
  const [rejection, setRejection] = useState<ImageRejection | null>(null);
  const [title, setTitle] = useState(mine?.title ?? '');
  const [description, setDescription] = useState(mine?.description ?? '');
  /**
   * `creditOptIn` is not in `PublicSubmissionDto` — the DTO is the anonymity
   * boundary and a flag about the uploader has no business crossing it. So the
   * checkbox cannot be pre-filled from the server and starts unticked, which
   * is the safe default anyway: opting in is a choice, never an inheritance.
   */
  const [creditOptIn, setCreditOptIn] = useState(false);
  const [failure, setFailure] = useState<SubmissionFailure | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

  // Object URLs are a real leak if a person tries five files before settling.
  const previousPreview = useRef<string | null>(null);
  useEffect(() => {
    const url = staged?.previewUrl ?? null;
    if (previousPreview.current && previousPreview.current !== url) {
      URL.revokeObjectURL(previousPreview.current);
    }
    previousPreview.current = url;
  }, [staged]);
  useEffect(
    () => () => {
      if (previousPreview.current) URL.revokeObjectURL(previousPreview.current);
    },
    [],
  );

  const upload = useMutation({
    mutationFn: (input: { file: File; title?: string; description?: string; creditOptIn: boolean }) =>
      api.upsertSubmission(input),
    onSuccess: () => {
      setStaged(null);
      setFailure(null);
      onChanged();
      toast.success(mine ? 'Your entry was replaced.' : 'Your entry is in.');
    },
    onError: (error: unknown) => {
      const described = describeSubmissionFailure(error);
      setFailure(described);
      if (described.phaseClosed) onPhaseClosed();
    },
  });

  const saveDetails = useMutation({
    mutationFn: (input: { title?: string; description?: string; creditOptIn: boolean }) =>
      api.updateSubmissionMeta(mine?.id ?? '', input),
    onSuccess: () => {
      setFailure(null);
      onChanged();
      toast.success('Details saved.');
    },
    onError: (error: unknown) => {
      const described = describeSubmissionFailure(error);
      setFailure(described);
      if (described.phaseClosed) onPhaseClosed();
    },
  });

  const busy = upload.isPending || saveDetails.isPending;

  const detailsDirty =
    (title.trim() || '') !== (mine?.title ?? '') ||
    (description.trim() || '') !== (mine?.description ?? '') ||
    creditOptIn;

  const titleTooLong = title.length > MAX_TITLE_LENGTH;
  const descriptionTooLong = description.length > MAX_DESCRIPTION_LENGTH;
  const textInvalid = titleTooLong || descriptionTooLong;

  const submitPayload = () => ({
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    creditOptIn,
  });

  const doUpload = () => {
    if (!staged) return;
    upload.mutate({ file: staged.file, ...submitPayload() });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || textInvalid) return;

    if (staged) {
      // Replacing is destructive in the way that matters — the old entry is
      // gone from the contest — so it is confirmed, not just announced.
      if (mine) setConfirmReplaceOpen(true);
      else doUpload();
      return;
    }

    if (mine && detailsDirty) saveDetails.mutate(submitPayload());
  };

  const previewSrc = staged?.previewUrl ?? mine?.displayUrl ?? null;
  const previewAlt = staged
    ? 'Preview of the logo you are about to upload'
    : mine
      ? entryAlt(mine)
      : '';

  const primaryLabel = staged ? (mine ? 'Replace my entry' : 'Submit my entry') : 'Save details';
  const primaryDisabled = busy || textInvalid || (!staged && !(mine && detailsDirty));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-roomy">
      <Panel>
        <PanelHeader
          eyebrow={mine ? 'Replace' : 'Upload'}
          title={mine ? 'Your logo' : 'Add your logo'}
          description={
            mine
              ? 'This is what everyone else sees, in the frame they see it in. Uploading a new file replaces it.'
              : 'It will appear in the same neutral frame as every other entry — no name, no border of its own, no ordering advantage.'
          }
        />

        <div className="grid gap-roomy p-roomy pt-0 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-start">
          {/* Exactly the gallery frame, so what they approve is what ships. */}
          <div className="space-y-2">
            {previewSrc ? (
              <EntryFrame src={previewSrc} alt={previewAlt} loading="eager" />
            ) : (
              <EmptyEntryFrame>Your logo will appear here</EmptyEntryFrame>
            )}
            <p className="text-center text-xs text-ink-subtle">
              {staged
                ? `New image · ${staged.width} × ${staged.height} px`
                : mine
                  ? `Current entry · ${mine.width} × ${mine.height} px`
                  : 'Every entry is shown in this frame'}
            </p>
          </div>

          <div className="space-y-4">
            {mine && !staged ? (
              <p className="flex items-start gap-2 rounded border border-line bg-paper-sunken p-snug text-xs text-ink-muted">
                <CheckCircle2 aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-success" />
                <span>
                  Your entry is in the contest. You do not need to do anything else unless you want to change
                  it.
                </span>
              </p>
            ) : null}

            {mine ? (
              <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning-soft p-snug text-xs text-ink">
                <TriangleAlert aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-warning" />
                <span>
                  <strong className="font-medium">This will replace your current entry.</strong> One logo per
                  person — the file above is removed from the contest and the new one takes its place. There
                  is no way to have two.
                </span>
              </p>
            ) : null}

            <UploadDropzone
              onAccepted={(image) => {
                setStaged(image);
                setRejection(null);
                setFailure((current) => (current?.field === 'file' ? null : current));
              }}
              onRejected={(next) => {
                setStaged(null);
                setRejection(next);
              }}
              disabled={busy}
              hasExistingEntry={Boolean(mine)}
              rejection={rejection}
            />

            {failure?.field === 'file' ? <InlineError>{failure.message}</InlineError> : null}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Optional"
          title="Name and describe it"
          description="Both are optional and both are shown next to your entry in the gallery."
        />

        <div className="space-y-roomy p-roomy pt-0">
          {/* The warning sits with the control it is about, above the box, so
              it is read before the box is filled rather than after. */}
          <div className="space-y-2">
            <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning-soft p-snug text-xs text-ink">
              <TriangleAlert aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-warning" />
              <span>
                <strong className="font-medium">Do not put your name in the title.</strong> Entries are voted
                on anonymously, and a title like “Sam’s mark” gives it away. Name the design, not yourself.
              </span>
            </p>

            <Field
              label="Title"
              htmlFor="entry-title"
              error={
                titleTooLong
                  ? `Titles are ${MAX_TITLE_LENGTH} characters or fewer.`
                  : failure?.field === 'title'
                    ? failure.message
                    : undefined
              }
            >
              <Input
                id="entry-title"
                name="title"
                value={title}
                maxLength={MAX_TITLE_LENGTH * 2}
                disabled={busy}
                placeholder="e.g. Seven Points"
                aria-invalid={titleTooLong || failure?.field === 'title' ? true : undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setFailure((current) => (current?.field === 'title' ? null : current));
                }}
              />
              {/* `Field.hint` is plain text by design; the live counter is rich
                  content, so it rides alongside the control in `children`. */}
              <CharCount value={title} max={MAX_TITLE_LENGTH} />
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor="entry-description"
            error={
              descriptionTooLong
                ? `Descriptions are ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
                : failure?.field === 'description'
                  ? failure.message
                  : undefined
            }
          >
            <Textarea
              id="entry-description"
              name="description"
              rows={3}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH * 2}
              disabled={busy}
              placeholder="A sentence on the idea, if it helps. Still no names."
              aria-invalid={descriptionTooLong || failure?.field === 'description' ? true : undefined}
              onChange={(event) => {
                setDescription(event.target.value);
                setFailure((current) => (current?.field === 'description' ? null : current));
              }}
            />
            <CharCount value={description} max={MAX_DESCRIPTION_LENGTH} />
          </Field>

          <Divider />

          <div className="flex items-start gap-3">
            <input
              id="credit-opt-in"
              name="creditOptIn"
              type="checkbox"
              checked={creditOptIn}
              disabled={busy}
              onChange={(event) => setCreditOptIn(event.target.checked)}
              aria-describedby="credit-opt-in-hint"
              className="mt-hair h-4 w-4 shrink-0 rounded-sm border border-line-strong accent-accent"
            />
            <div className="space-y-1">
              <Label htmlFor="credit-opt-in" className="cursor-pointer">
                If my entry wins, credit me by name.
              </Label>
              <p id="credit-opt-in-hint" className="flex items-start gap-2 text-xs text-ink-muted">
                <Info aria-hidden="true" className="mt-hair h-3 w-3 shrink-0" />
                <span>
                  Your name stays hidden throughout — during submissions, during voting, and on every losing
                  entry. It is revealed only if this entry wins, and only then. Leave it unticked to stay
                  anonymous even in victory.
                </span>
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* Failures that belong to no single control. */}
      {failure && !failure.field ? <InlineError>{failure.message}</InlineError> : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={busy} disabled={primaryDisabled}>
          {primaryLabel}
        </Button>

        {staged ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStaged(null);
              setRejection(null);
            }}
          >
            Discard this file
          </Button>
        ) : null}

        {!staged && !mine ? (
          <p className="text-xs text-ink-subtle">Choose a file above to enable submitting.</p>
        ) : null}
      </div>

      {/* Indeterminate by design: the API client posts with `fetch`, which
          reports no upload progress. A fake percentage would be a lie; a bar
          that says "still working" is the honest version. */}
      <div aria-live="polite">
        {busy ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">
              {upload.isPending
                ? 'Uploading your entry. Keep this tab open — it will not take long.'
                : 'Saving your details…'}
            </p>
            <div
              role="progressbar"
              aria-label={upload.isPending ? 'Uploading your entry' : 'Saving your details'}
              className="h-1 w-full overflow-hidden rounded-full bg-paper-sunken"
            >
              <div className="h-full w-1/3 animate-shimmer rounded-full bg-accent" />
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmReplaceOpen}
        onOpenChange={setConfirmReplaceOpen}
        title="Replace your entry?"
        description="Your current logo is removed from the contest and this new file takes its place. One entry per person, so there is no way to keep both. You can replace it again any time before submissions close."
        confirmLabel="Replace my entry"
        cancelLabel="Keep the current one"
        onConfirm={() => {
          setConfirmReplaceOpen(false);
          doUpload();
        }}
      />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Withdraw                                                                    */
/* -------------------------------------------------------------------------- */

function WithdrawControl({
  id,
  onChanged,
  onPhaseClosed,
}: {
  id: string;
  onChanged: () => void;
  onPhaseClosed: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<SubmissionFailure | null>(null);

  const withdraw = useMutation({
    mutationFn: () => api.withdrawSubmission(id),
    onSuccess: () => {
      setFailure(null);
      onChanged();
      toast.success('Your entry was withdrawn.');
    },
    onError: (error: unknown) => {
      const described = describeSubmissionFailure(error);
      setFailure(described);
      if (described.phaseClosed) onPhaseClosed();
    },
  });

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="danger"
        loading={withdraw.isPending}
        disabled={withdraw.isPending}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        Withdraw my entry
      </Button>

      {failure ? <InlineError>{failure.message}</InlineError> : null}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="Withdraw your entry from the contest?"
        description="Your logo is removed from the gallery, nobody will be able to rank it, and any ranking it already has is discarded. This cannot be undone — but you can upload a new entry any time before submissions close."
        confirmLabel="Withdraw my entry"
        cancelLabel="Keep it in"
        onConfirm={() => {
          setOpen(false);
          withdraw.mutate();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Submissions closed                                                          */
/* -------------------------------------------------------------------------- */

/**
 * No upload control, no replace, no withdraw — not even disabled ones. What
 * replaces them is the thing a person actually wants at this point: whether
 * their entry made it, and what happens next.
 */
function LockedState({
  mine,
  contest,
}: {
  mine: PublicSubmissionDto | null;
  contest: {
    phase: string;
    votingOpensAt: string | null;
    votingClosesAt: string | null;
    serverNow: string;
  } | null;
}): JSX.Element {
  const votingOpensAt = contest?.votingOpensAt ?? null;
  const votingClosesAt = contest?.votingClosesAt ?? null;
  const serverNow = contest?.serverNow ?? null;
  const phase = contest?.phase ?? 'CLOSED';

  const next =
    phase === 'VOTING_OPEN'
      ? 'Voting is open now. Rank your top five on the ballot.'
      : phase === 'RESULTS_PUBLISHED'
        ? 'The results are published.'
        : votingOpensAt
          ? 'Voting opens shortly. You will be able to rank your top five then.'
          : 'Voting opens once the entries have been shuffled and numbered.';

  return (
    <div className="grid gap-loose lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <Panel>
        <PanelHeader
          eyebrow="Closed"
          title={mine ? 'Your entry is in' : 'Submissions are closed'}
          description={
            mine
              ? 'The deadline has passed. This is the entry that goes to the vote — it can no longer be replaced or withdrawn.'
              : 'The deadline has passed and no entry was uploaded from this account. Nothing further is needed from you here.'
          }
        />

        <div className="p-roomy pt-0">
          {mine ? (
            <div className="grid gap-roomy sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-start">
              <EntryFrame src={mine.displayUrl} alt={entryAlt(mine)} loading="eager" />
              <div className="space-y-2">
                {mine.title ? <p className="text-body text-ink">{mine.title}</p> : null}
                {mine.description ? <p className="text-sm text-ink-muted">{mine.description}</p> : null}
                <p className="text-xs text-ink-subtle" data-tabular>
                  {mine.alias ? `${mine.alias} · ` : ''}
                  {mine.width} × {mine.height} px
                </p>
              </div>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <Lock aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-ink-subtle" />
              <span>
                Entries closed before anything was uploaded from this account. You can still vote — every
                teammate gets a ballot, whether or not they entered.
              </span>
            </p>
          )}
        </div>
      </Panel>

      <aside>
        <Panel>
          <div className="space-y-3 p-roomy">
            <p className="eyebrow">What happens next</p>
            <p className="text-sm text-ink-muted">{next}</p>

            {phase !== 'VOTING_OPEN' && votingOpensAt && serverNow ? (
              <div className="space-y-1">
                <p className="text-xs text-ink-subtle">Voting opens in</p>
                <Countdown to={votingOpensAt} serverNow={serverNow} />
              </div>
            ) : null}

            {phase === 'VOTING_OPEN' && votingClosesAt && serverNow ? (
              <div className="space-y-1">
                <p className="text-xs text-ink-subtle">Voting closes in</p>
                <Countdown to={votingClosesAt} serverNow={serverNow} />
              </div>
            ) : null}

            <p className="text-xs text-ink-subtle">
              Entries are numbered in a shuffled order at close, so the numbering does not reveal who
              uploaded when.
            </p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function InlineError({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p role="alert" className={cn('flex items-start gap-2 text-sm text-danger')}>
      <AlertCircle aria-hidden="true" className="mt-hair h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function MyEntrySkeleton(): JSX.Element {
  return (
    <div className="space-y-loose">
      <span className="sr-only" role="status">
        Loading your entry
      </span>
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-[12rem]" />
      </div>
      <div className="grid gap-loose lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" aria-hidden="true">
        <Skeleton className="aspect-square w-full max-w-[16rem] rounded" />
        <Skeleton className="h-32 w-full rounded" />
      </div>
    </div>
  );
}

export default MyEntry;
