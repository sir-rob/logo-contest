/**
 * Top-level Contests directory & registration screen.
 *
 *   - Regular members see all contests they have registered for with a contest
 *     code, plus a form to register for additional contests using a code shared
 *     by an organiser.
 *   - Administrators see ALL contests across the platform, including each
 *     contest's unique code, and can create new contests directly from here.
 */

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Plus, Settings, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  PHASE_LABELS,
  type ContestPublicDto,
  type CreateContestBody,
} from '@contest/shared';
import { api, ApiClientError } from '@/lib/api';
import { useActiveContestId, useContestsQuery } from '@/lib/contest';
import { queryKeys } from '@/lib/query-client';
import { useAuth } from '@/auth/AuthProvider';
import { ROUTES } from '@/routes';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  Spinner,
  Textarea,
} from '@/components/ui';

export function Contests(): JSX.Element {
  const { isAdmin, refresh } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeContestId, selectContest] = useActiveContestId();
  const contestsQuery = useContestsQuery(true);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const joinMutation = useMutation({
    mutationFn: (rawCode: string) => api.joinContest(rawCode),
    onSuccess: async (joined) => {
      setCode('');
      setCodeError(null);
      selectContest(joined.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.contests });
      await refresh();
      toast.success(`Registered for ${joined.title}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setCodeError(err.message);
      } else {
        setCodeError('Could not register with that code. Please try again.');
      }
    },
  });

  const onJoinSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 2) {
      setCodeError('Enter the contest code shared by your contest organiser.');
      return;
    }
    setCodeError(null);
    joinMutation.mutate(trimmed);
  };

  const handleOpenContest = (contest: ContestPublicDto, destination: string = ROUTES.dashboard): void => {
    selectContest(contest.id);
    navigate(destination);
  };

  const contests = contestsQuery.data ?? [];

  return (
    <div className="space-y-section">
      <PageHeader
        eyebrow="Contest directory"
        title={isAdmin ? 'All contests' : 'Your contests'}
        description={
          isAdmin
            ? 'As an administrator you can view and manage every contest, create new contests, and share each contest’s unique registration code with participants.'
            : 'Select a contest below to view entries, upload your submission, or cast your ranked-choice ballot. Have a new contest code? Enter it below to register.'
        }
        actions={
          isAdmin ? (
            <Button
              variant="primary"
              onClick={() => {
                setShowCreateForm((prev) => !prev);
              }}
            >
              <Plus aria-hidden="true" className="mr-tight h-4 w-4" />
              {showCreateForm ? 'Close form' : 'New contest'}
            </Button>
          ) : undefined
        }
      />

      {isAdmin && showCreateForm ? (
        <CreateContestPanel
          onCreated={async (created) => {
            setShowCreateForm(false);
            selectContest(created.id);
            await queryClient.invalidateQueries({ queryKey: queryKeys.contests });
            toast.success(`Created "${created.title}" (Code: ${created.code ?? ''})`);
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : null}

      {/* Register with a contest code */}
      <Panel className="rounded border border-line bg-paper-raised p-roomy">
        <PanelHeader
          eyebrow="Join a contest"
          title="Register with a contest code"
          description="Enter the unique code provided by the contest organiser to add a contest to your home page."
        />
        <form onSubmit={onJoinSubmit} className="mt-base flex flex-col gap-snug sm:flex-row sm:items-end" noValidate>
          <div className="flex-1">
            <Field
              label="Contest code"
              htmlFor="join-contest-code"
              error={codeError ?? undefined}
            >
              <Input
                id="join-contest-code"
                name="code"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. NORTH7"
                value={code}
                disabled={joinMutation.isPending}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  if (codeError) setCodeError(null);
                }}
              />
            </Field>
          </div>
          <Button
            type="submit"
            variant="secondary"
            loading={joinMutation.isPending}
            disabled={joinMutation.isPending}
          >
            <KeyRound aria-hidden="true" className="mr-tight h-4 w-4" />
            Register for contest
          </Button>
        </form>
      </Panel>

      {/* Contest cards */}
      {contestsQuery.isPending ? (
        <Panel className="p-roomy">
          <Spinner label="Loading contests" />
        </Panel>
      ) : contests.length === 0 ? (
        <Panel>
          <EmptyState
            title="No contests registered yet"
            description="Enter a contest code above to register for your first contest. Once registered, it will appear here."
          />
        </Panel>
      ) : (
        <div className="grid gap-base md:grid-cols-2">
          {contests.map((c) => {
            const isSelected = activeContestId === c.id;
            return (
              <Panel
                key={c.id}
                className="flex flex-col justify-between rounded border border-line bg-paper-raised p-roomy"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-snug">
                    <Badge tone={c.phase === 'VOTING_OPEN' || c.phase === 'SUBMISSIONS_OPEN' ? 'accent' : 'neutral'}>
                      {PHASE_LABELS[c.phase]}
                    </Badge>
                    <div className="flex items-center gap-tight">
                      {c.code ? (
                        <span
                          className="rounded border border-line bg-paper-sunken px-snug py-0.5 font-mono text-xs text-ink-muted"
                          title="Contest registration code"
                        >
                          Code: <strong className="font-semibold text-ink">{c.code}</strong>
                        </span>
                      ) : null}
                      {isSelected ? <Badge tone="success">Active</Badge> : null}
                    </div>
                  </div>

                  <h2 className="mt-snug font-display text-lead text-ink">{c.title}</h2>
                  {c.description ? (
                    <p className="mt-tight text-sm text-ink-muted">{c.description}</p>
                  ) : null}
                </div>

                <div className="mt-roomy flex flex-wrap items-center gap-snug pt-snug border-t border-line">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleOpenContest(c, ROUTES.dashboard)}
                  >
                    Open contest
                    <ArrowRight aria-hidden="true" className="ml-tight h-4 w-4" />
                  </Button>

                  {isAdmin ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenContest(c, ROUTES.admin)}
                    >
                      <Settings aria-hidden="true" className="mr-tight h-4 w-4" />
                      Admin controls
                    </Button>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateContestPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (contest: ContestPublicDto) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: CreateContestBody) => api.admin.createContest(body),
    onSuccess: async (created) => {
      await onCreated(created);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields ?? {});
        setGeneralError(err.message);
      } else {
        setGeneralError('Could not create the contest.');
      }
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (title.trim().length === 0) {
      nextErrors['title'] = 'Give the contest a name.';
    }
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 2) {
      nextErrors['code'] = 'Provide a unique code (at least 2 characters).';
    } else if (!/^[A-Z0-9_-]+$/.test(cleanCode)) {
      nextErrors['code'] = 'Code may only contain letters, numbers, hyphens, or underscores.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setGeneralError(null);
    createMutation.mutate({
      title: title.trim(),
      code: cleanCode,
      description: description.trim(),
    });
  };

  return (
    <Panel className="rounded border border-accent/40 bg-paper-raised p-roomy">
      <PanelHeader
        eyebrow="Administration"
        title="Create a new contest"
        description="Name the contest, describe what participants should upload and vote on, and set the unique registration code to share with participants."
      />

      <form onSubmit={handleSubmit} className="mt-base space-y-base" noValidate>
        <div className="grid gap-base sm:grid-cols-2">
          <Field
            label="Contest name"
            htmlFor="new-contest-title"
            required
            hint="Shown in the header and on the contest home page."
            error={fieldErrors['title']}
          >
            <Input
              id="new-contest-title"
              value={title}
              placeholder="e.g. Q4 Team Offsite Photo Contest"
              disabled={createMutation.isPending}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field
            label="Unique contest code"
            htmlFor="new-contest-code"
            required
            hint="Participants enter this code to register and see the contest."
            error={fieldErrors['code']}
          >
            <Input
              id="new-contest-code"
              value={code}
              placeholder="e.g. OFFSITE26"
              disabled={createMutation.isPending}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
        </div>

        <Field
          label="Description & prompt"
          htmlFor="new-contest-description"
          hint="Explain what the contest is for and what kind of images participants should submit."
          error={fieldErrors['description']}
        >
          <Textarea
            id="new-contest-description"
            rows={3}
            value={description}
            placeholder="Upload one image, then rank your top choices..."
            disabled={createMutation.isPending}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {generalError && Object.keys(fieldErrors).length === 0 ? (
          <p role="alert" className="text-sm text-danger">
            {generalError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-snug">
          <Button
            type="submit"
            variant="primary"
            loading={createMutation.isPending}
            disabled={createMutation.isPending}
          >
            <Sparkles aria-hidden="true" className="mr-tight h-4 w-4" />
            Create contest
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={createMutation.isPending}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export { Contests as ContestsPage };
export default Contests;
