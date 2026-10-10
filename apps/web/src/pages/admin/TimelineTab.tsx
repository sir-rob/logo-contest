/**
 * Tab 1 — Timeline & settings.
 *
 * The four deadlines are the contest. Everything else on this page is a knob;
 * these are the thing people plan their week around, so:
 *
 *  - every date is echoed back in the admin's own timezone, named, right under
 *    the input that produced it;
 *  - `validateContestDates()` from @contest/shared runs BEFORE the request, so
 *    the UI and the server reject the same nonsense with the same wording
 *    rather than the client inventing a second, subtly different rulebook.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Save } from 'lucide-react';
import {
  DEFAULT_MIN_BALLOTS_TO_PUBLISH,
  validateContestDates,
  type ContestPublicDto,
  type UpdateContestBody,
} from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Button,
  CharCount,
  Divider,
  Field,
  Input,
  Panel,
  PanelHeader,
  Switch,
  Textarea,
} from '@/components/ui';
import {
  adminErrorMessage,
  fieldErrorsOf,
  formatAbsolute,
  isoToLocalInput,
  localInputToIso,
  localTimeZone,
  timeZoneAbbreviation,
  toDateOrNull,
} from './admin-shared';

interface TimelineTabProps {
  contest: ContestPublicDto;
}

interface FormState {
  title: string;
  description: string;
  code: string;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpensAt: string;
  votingClosesAt: string;
  allowSelfVote: boolean;
  showLiveStandings: boolean;
  minBallotsToPublish: string;
}

function initialState(contest: ContestPublicDto): FormState {
  return {
    title: contest.title,
    description: contest.description,
    code: contest.code ?? 'NORTH7',
    submissionsOpenAt: isoToLocalInput(contest.submissionsOpenAt),
    submissionsCloseAt: isoToLocalInput(contest.submissionsCloseAt),
    votingOpensAt: isoToLocalInput(contest.votingOpensAt),
    votingClosesAt: isoToLocalInput(contest.votingClosesAt),
    allowSelfVote: contest.allowSelfVote,
    showLiveStandings: contest.showLiveStandings,
    minBallotsToPublish: String(DEFAULT_MIN_BALLOTS_TO_PUBLISH),
  };
}

const DATE_FIELDS = [
  {
    key: 'submissionsOpenAt',
    label: 'Submissions open',
    hint: 'Before this, the gallery and the upload form are hidden.',
  },
  {
    key: 'submissionsCloseAt',
    label: 'Submissions close',
    hint: 'Entries are frozen and anonymous aliases (“Entry 07”) are assigned.',
  },
  {
    key: 'votingOpensAt',
    label: 'Voting opens',
    hint: 'Ranked ballots can be cast and edited from this moment.',
  },
  {
    key: 'votingClosesAt',
    label: 'Voting closes',
    hint: 'Ballots are sealed. Results can be computed after this.',
  },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    FormState,
    'submissionsOpenAt' | 'submissionsCloseAt' | 'votingOpensAt' | 'votingClosesAt'
  >;
  label: string;
  hint: string;
}>;

/**
 * A labelled toggle. The one-line explanation is not decoration: "allow self
 * vote" means nothing on its own, and an admin flipping it blind is how a
 * contest quietly changes its rules mid-flight.
 */
function SettingToggle({
  id,
  label,
  effect,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  effect: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 py-base">
      <div className="max-w-measure">
        <label htmlFor={id} className="block text-body font-medium text-ink">
          {label}
        </label>
        <p id={`${id}-effect`} className="mt-hair text-sm text-ink-muted">
          {effect}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-effect`}
        className="mt-1 shrink-0"
      />
    </div>
  );
}

export function TimelineTab({ contest }: TimelineTabProps): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(() => initialState(contest));
  const [serverFieldErrors, setServerFieldErrors] = React.useState<Record<string, string>>({});

  // Re-seed only when the server hands back a genuinely different contest
  // document, so a background refetch cannot eat an admin's half-typed edit.
  const lastSyncedId = React.useRef(contest.id);
  React.useEffect(() => {
    if (lastSyncedId.current !== contest.id) {
      lastSyncedId.current = contest.id;
      setForm(initialState(contest));
    }
  }, [contest]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerFieldErrors((prev) => (key in prev ? { ...prev, [key]: '' } : prev));
  };

  /**
   * The authoritative check, imported rather than reimplemented. If the server
   * ever changes what counts as a valid timeline, this moves with it.
   */
  const dateErrors = React.useMemo(
    () =>
      validateContestDates({
        submissionsOpenAt: toDateOrNull(localInputToIso(form.submissionsOpenAt)),
        submissionsCloseAt: toDateOrNull(localInputToIso(form.submissionsCloseAt)),
        votingOpensAt: toDateOrNull(localInputToIso(form.votingOpensAt)),
        votingClosesAt: toDateOrNull(localInputToIso(form.votingClosesAt)),
      }),
    [form.submissionsOpenAt, form.submissionsCloseAt, form.votingOpensAt, form.votingClosesAt],
  );

  const floor = Number.parseInt(form.minBallotsToPublish, 10);
  const floorError =
    form.minBallotsToPublish.trim() === '' || Number.isNaN(floor) || floor < 1
      ? 'Enter a whole number of ballots, at least 1.'
      : '';

  const titleError = form.title.trim() === '' ? 'The contest needs a title.' : '';
  const codeError =
    form.code.trim().length < 2
      ? 'Enter a unique contest code (at least 2 characters).'
      : !/^[A-Za-z0-9_-]+$/.test(form.code.trim())
        ? 'Code may only contain letters, numbers, hyphens, or underscores.'
        : '';

  const blocked = dateErrors.length > 0 || floorError !== '' || titleError !== '' || codeError !== '';

  const mutation = useMutation({
    mutationFn: (body: UpdateContestBody) => api.admin.updateContest(body),
    onSuccess: async (updated) => {
      setServerFieldErrors({});
      queryClient.setQueryData(queryKeys.contest, updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contest }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
      toast.success('Timeline and settings saved.');
    },
    onError: (error: unknown) => {
      setServerFieldErrors(fieldErrorsOf(error));
      toast.error(adminErrorMessage(error, 'Could not save the contest settings.'));
    },
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocked) return;
    mutation.mutate({
      title: form.title.trim(),
      description: form.description,
      code: form.code.trim().toUpperCase(),
      submissionsOpenAt: localInputToIso(form.submissionsOpenAt),
      submissionsCloseAt: localInputToIso(form.submissionsCloseAt),
      votingOpensAt: localInputToIso(form.votingOpensAt),
      votingClosesAt: localInputToIso(form.votingClosesAt),
      allowSelfVote: form.allowSelfVote,
      showLiveStandings: form.showLiveStandings,
      minBallotsToPublish: floor,
    });
  };

  const zone = timeZoneAbbreviation();

  return (
    <form onSubmit={onSubmit} className="space-y-loose">
      <Panel>
        <PanelHeader
          eyebrow="Timeline"
          title="Key dates"
          description={`Shown and entered in your own timezone — ${localTimeZone} (${zone}). Members see these same moments converted to theirs.`}
        />
        <Divider />

        <div className="grid gap-roomy p-roomy sm:grid-cols-2">
          {DATE_FIELDS.map((field) => {
            const value = form[field.key];
            const iso = localInputToIso(value);
            return (
              <Field
                key={field.key}
                label={field.label}
                htmlFor={`contest-${field.key}`}
                hint={field.hint}
                error={serverFieldErrors[field.key] || undefined}
              >
                <Input
                  id={`contest-${field.key}`}
                  type="datetime-local"
                  value={value}
                  onChange={(event) => set(field.key, event.target.value)}
                  aria-describedby={`contest-${field.key}-resolved`}
                />
                <p
                  id={`contest-${field.key}-resolved`}
                  className="mt-hair text-sm tabular-nums text-ink-muted"
                >
                  {iso ? formatAbsolute(iso) : `Not set — this stage has no ${field.label.toLowerCase()} time.`}
                </p>
              </Field>
            );
          })}
        </div>

        {dateErrors.length > 0 && (
          <div className="mx-roomy mb-roomy rounded border border-danger bg-danger-soft p-base">
            <p className="text-sm font-medium text-danger">
              <CalendarClock aria-hidden className="mr-2 inline size-4 align-text-bottom" />
              This timeline will be rejected:
            </p>
            <ul className="mt-tight list-disc space-y-hair pl-5 text-sm text-ink">
              {dateErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        {serverFieldErrors['dates'] && (
          <p role="alert" className="mx-roomy mb-roomy text-sm text-danger">
            {serverFieldErrors['dates']}
          </p>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Behaviour"
          title="Voting rules"
          description="Each of these changes what members can see or do, immediately on save."
        />
        <Divider />
        <div className="divide-y divide-line px-roomy">
          <SettingToggle
            id="setting-live-standings"
            label="Show live standings"
            effect="Visible to everyone during voting; turning this off hides the running tally until results are published."
            checked={form.showLiveStandings}
            onCheckedChange={(next) => set('showLiveStandings', next)}
          />
          <SettingToggle
            id="setting-self-vote"
            label="Allow self-voting"
            effect="Lets an entrant rank their own logo. Turning this off makes a ballot that includes the voter's own entry invalid."
            checked={form.allowSelfVote}
            onCheckedChange={(next) => set('allowSelfVote', next)}
          />
        </div>
        <Divider />
        <div className="p-roomy">
          <Field
            label="Minimum ballots to publish"
            htmlFor="setting-min-ballots"
            required
            hint="The anonymity floor. Results stay sealed until at least this many ballots exist, because a tally drawn from three or four voters can be read backwards to the people who cast them."
            error={floorError || serverFieldErrors['minBallotsToPublish'] || undefined}
          >
            <Input
              id="setting-min-ballots"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className="max-w-32 tabular-nums"
              value={form.minBallotsToPublish}
              onChange={(event) => set('minBallotsToPublish', event.target.value)}
            />
          </Field>
          <p className="mt-tight max-w-measure text-sm text-ink-subtle">
            The contest API does not report the stored floor, so this box starts at the project
            default of {DEFAULT_MIN_BALLOTS_TO_PUBLISH}. Saving this form writes whatever is shown
            here — check it before you save if someone has changed it.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Presentation & access" title="Title, registration code and description" />
        <Divider />
        <div className="space-y-roomy p-roomy">
          <div className="grid gap-roomy sm:grid-cols-2">
            <Field
              label="Contest title"
              htmlFor="contest-title"
              required
              error={titleError || serverFieldErrors['title'] || undefined}
            >
              <Input
                id="contest-title"
                value={form.title}
                maxLength={120}
                onChange={(event) => set('title', event.target.value)}
              />
              <CharCount value={form.title} max={120} />
            </Field>

            <Field
              label="Unique contest code"
              htmlFor="contest-code"
              required
              hint="Share this code with participants so they can register for this contest."
              error={codeError || serverFieldErrors['code'] || undefined}
            >
              <Input
                id="contest-code"
                value={form.code}
                maxLength={32}
                onChange={(event) => set('code', event.target.value.toUpperCase())}
              />
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor="contest-description"
            hint="Shown on the member dashboard. Brief and specific beats comprehensive."
            error={serverFieldErrors['description'] || undefined}
          >
            <Textarea
              id="contest-description"
              rows={5}
              maxLength={2000}
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
            />
            <CharCount value={form.description} max={2000} />
          </Field>
        </div>
      </Panel>

      <div className="flex items-center gap-base">
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={blocked}>
          <Save aria-hidden className="size-4" />
          Save changes
        </Button>
        {blocked && (
          <p className="text-sm text-ink-muted">
            Fix the problems above before saving.
          </p>
        )}
      </div>
    </form>
  );
}
