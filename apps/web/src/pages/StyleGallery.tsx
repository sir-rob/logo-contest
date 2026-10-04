/**
 * Style gallery.
 *
 * Every primitive, in every variant and state, on one page — so the accent can
 * be chosen by looking at the real thing rather than at a swatch.
 *
 * This page is a specimen, not product surface. It is the one place in the app
 * where it is correct to put four primary buttons next to each other.
 */

import { useState, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import {
  AccentToggle,
  Badge,
  Button,
  CharCount,
  ConfirmDialog,
  Countdown,
  Divider,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Panel,
  PanelHeader,
  Skeleton,
  Spinner,
  Stat,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useAccent,
} from '@/components/ui';

/* -------------------------------------------------------------------------
 * Page scaffolding
 * ---------------------------------------------------------------------- */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="scroll-mt-loose">
      <div className="mb-base">
        <h2 className="eyebrow">{title}</h2>
        {note ? <p className="mt-hair max-w-measure text-sm text-ink-muted">{note}</p> : null}
      </div>
      <hr className="rule mb-roomy" />
      {children}
    </section>
  );
}

/** Labelled slot, so each specimen says what it is. */
function Spec({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-tight">
      <span className="font-sans text-xs text-ink-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-snug">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Mock logos.
 *
 * Six marks drawn in ink so the frames can be judged on presentation alone —
 * identical aspect, padding, ground and border for every entry, which is the
 * whole point of `.entry-frame`. Nothing here loads over the network.
 * ---------------------------------------------------------------------- */

const MARKS: ReadonlyArray<{ alias: string; mark: JSX.Element }> = [
  {
    alias: 'Entry 01',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink" fill="none" stroke="currentColor">
        <circle cx="60" cy="60" r="46" strokeWidth="2" />
        <path d="M38 78V42l44 36V42" strokeWidth="6" strokeLinecap="square" />
      </svg>
    ),
  },
  {
    alias: 'Entry 02',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink" fill="none" stroke="currentColor">
        <rect x="20" y="20" width="80" height="80" strokeWidth="2" />
        <path d="M20 60h80M60 20v80" strokeWidth="2" />
        <circle cx="60" cy="60" r="18" strokeWidth="6" />
      </svg>
    ),
  },
  {
    alias: 'Entry 03',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink">
        <text
          x="60"
          y="76"
          textAnchor="middle"
          className="font-display"
          fontSize="56"
          fill="currentColor"
        >
          N7
        </text>
        <rect x="24" y="88" width="72" height="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    alias: 'Entry 04',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink" fill="none" stroke="currentColor">
        <path d="M60 18l36 21v42L60 102 24 81V39z" strokeWidth="2" />
        <path d="M60 42l18 10.5v21L60 84 42 73.5v-21z" strokeWidth="4" />
      </svg>
    ),
  },
  {
    alias: 'Entry 05',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink" fill="none" stroke="currentColor">
        <circle cx="44" cy="60" r="26" strokeWidth="3" />
        <circle cx="76" cy="60" r="26" strokeWidth="3" />
        <path d="M60 38v44" strokeWidth="3" />
      </svg>
    ),
  },
  {
    alias: 'Entry 06',
    mark: (
      <svg viewBox="0 0 120 120" className="h-16 w-16 text-ink" fill="none" stroke="currentColor">
        <path d="M24 88L48 40l24 34 12-20 12 34z" strokeWidth="3" strokeLinejoin="round" />
        <path d="M18 96h84" strokeWidth="3" />
      </svg>
    ),
  },
];

const BADGE_TONES = [
  { tone: 'neutral' as const, label: 'Draft' },
  { tone: 'accent' as const, label: 'Voting open' },
  { tone: 'success' as const, label: 'Submitted' },
  { tone: 'warning' as const, label: 'Closing soon' },
  { tone: 'danger' as const, label: 'Disqualified' },
];

/* -------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------- */

export function StyleGallery(): JSX.Element {
  const { accent } = useAccent();

  const [title, setTitle] = useState('Northbound');
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [submissionsOpen, setSubmissionsOpen] = useState(true);
  const [overlapWindows, setOverlapWindows] = useState(false);

  // Frozen at mount so the specimens do not drift while the page is open.
  // In the real app `serverNow` arrives from the API, never from the browser.
  const [clock] = useState(() => {
    const now = Date.now();
    const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
    return {
      serverNow: new Date(now).toISOString(),
      inDays: iso(2 * 86_400_000 + 4 * 3_600_000),
      inHours: iso(4 * 3_600_000 + 12 * 60_000 + 9_000),
      inMinutes: iso(12 * 60_000 + 9_000),
      past: iso(-3_600_000),
    };
  });

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-page px-base py-section sm:px-loose">
        <PageHeader
          eyebrow="Media Moguls · North 7"
          title="Style gallery"
          description="Every primitive in the contest UI, in every state. Near-monochrome by construction: warm paper, deep ink, a graphite scale, and exactly one accent reserved for the primary action and the current state."
          actions={<Badge tone="accent">{accent === 'bronze' ? 'Bronze' : 'Teal'}</Badge>}
        />

        {/* ---------------------------------------------------------------
         * The decision this page exists to support.
         * ------------------------------------------------------------ */}
        <div className="mt-loose rounded-lg border border-line bg-paper-raised p-roomy">
          <div className="flex flex-wrap items-end justify-between gap-roomy">
            <div className="max-w-measure">
              <h2 className="font-display text-display-md text-ink">Pick the accent</h2>
              <p className="mt-tight text-body text-ink-muted">
                This swaps <code className="font-mono text-sm text-ink">data-accent</code> on the document
                root and repaints the entire palette live — every button, badge, focus ring and countdown
                on this page, with no reload. Bronze reads warm and editorial against the paper; teal sits
                cooler and slightly more &ldquo;interface&rdquo;. Everything below updates as you choose.
              </p>
            </div>
            <AccentToggle />
          </div>
        </div>

        <div className="mt-section grid gap-section">
          {/* -------------------------------------------------------------
           * Type
           * ---------------------------------------------------------- */}
          <Section
            title="Type"
            note="A high-contrast serif for display, a neutral grotesque for UI. No more than two weights in play at once."
          >
            <div className="grid gap-roomy">
              <div className="grid gap-snug border-b border-line pb-roomy">
                <p className="font-display text-display-xl text-ink">Display XL — 60px</p>
                <p className="font-display text-display-lg text-ink">Display LG — 44px</p>
                <p className="font-display text-display-md text-ink">Display MD — 32px</p>
                <p className="font-display text-display-sm text-ink">Display SM — 24px</p>
              </div>
              <div className="grid max-w-measure gap-snug">
                <p className="text-lead text-ink">
                  Lead, 18px. Used for the sentence under a page title — long enough to explain the screen,
                  short enough that nobody skips it.
                </p>
                <p className="text-body text-ink">
                  Body, 15px. The default. Generous leading, set to a 68-character measure so a paragraph
                  never runs wider than the eye can track comfortably.
                </p>
                <p className="text-sm text-ink-muted">
                  Small, 14px, muted ink — secondary copy, hints and descriptions.
                </p>
                <p className="text-xs text-ink-muted">
                  Extra small, 13px — field hints, timestamps, counts.
                </p>
                <p className="eyebrow">Eyebrow — section label</p>
              </div>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Buttons
           * ---------------------------------------------------------- */}
          <Section
            title="Buttons"
            note="Primary is the only filled shape in the system — two on a screen means one of them is wrong. Danger is reserved for withdraw and disqualify."
          >
            <div className="grid gap-roomy">
              <Spec label="Variants — medium">
                <Button variant="primary">Submit entry</Button>
                <Button variant="secondary">Save draft</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Withdraw</Button>
              </Spec>

              <Spec label="Sizes — small, medium, large">
                <Button variant="primary" size="sm">
                  Small
                </Button>
                <Button variant="primary" size="md">
                  Medium
                </Button>
                <Button variant="primary" size="lg">
                  Large
                </Button>
                <Button variant="secondary" size="sm">
                  Small
                </Button>
                <Button variant="secondary" size="md">
                  Medium
                </Button>
                <Button variant="secondary" size="lg">
                  Large
                </Button>
              </Spec>

              <Spec label="Disabled">
                <Button variant="primary" disabled>
                  Submit entry
                </Button>
                <Button variant="secondary" disabled>
                  Save draft
                </Button>
                <Button variant="ghost" disabled>
                  Cancel
                </Button>
                <Button variant="danger" disabled>
                  Withdraw
                </Button>
              </Spec>

              <Spec label="Loading — spinner, aria-busy, and the button disables itself">
                <Button variant="primary" loading>
                  Submitting
                </Button>
                <Button variant="secondary" loading>
                  Saving
                </Button>
                <Button variant="ghost" loading>
                  Loading
                </Button>
                <Button variant="danger" loading>
                  Withdrawing
                </Button>
              </Spec>

              <Spec label="Loading × size">
                <Button variant="primary" size="sm" loading>
                  Small
                </Button>
                <Button variant="primary" size="md" loading>
                  Medium
                </Button>
                <Button variant="primary" size="lg" loading>
                  Large
                </Button>
              </Spec>

              <div className="grid gap-tight">
                <span className="font-sans text-xs text-ink-subtle">Full width</span>
                <div className="grid max-w-measure gap-tight">
                  <Button variant="primary" fullWidth>
                    Cast ballot
                  </Button>
                  <Button variant="secondary" fullWidth>
                    Back to gallery
                  </Button>
                </div>
              </div>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Fields
           * ---------------------------------------------------------- */}
          <Section
            title="Fields"
            note="Every control has a real <label> wired with htmlFor. Hints and errors are connected with aria-describedby; errors also set aria-invalid and carry an icon, so the state survives being read in greyscale."
          >
            <div className="grid gap-roomy md:grid-cols-2">
              <Field label="Entry title" htmlFor="spec-plain">
                <Input placeholder="e.g. Northbound" />
              </Field>

              <Field
                label="Entry title"
                htmlFor="spec-hint"
                hint="Shown to voters alongside your logo. Keep it short."
              >
                <Input defaultValue="Northbound" />
              </Field>

              <Field
                label="Display alias"
                htmlFor="spec-required"
                required
                hint="Your real name is never shown while voting is open."
              >
                <Input defaultValue="Quiet Compass" />
              </Field>

              <Field
                label="Entry title"
                htmlFor="spec-error"
                error="An entry with this title already exists."
                hint="Shown to voters alongside your logo."
              >
                <Input defaultValue="Northbound" />
              </Field>

              <Field label="Disabled while the window is closed" htmlFor="spec-disabled">
                <Input defaultValue="Submissions have closed" disabled />
              </Field>

              <div className="grid gap-tight">
                <Field
                  label="Entry title"
                  htmlFor="spec-count"
                  required
                  hint="Counts toward the 32-character budget."
                >
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </Field>
                <CharCount value={title} max={32} />
              </div>

              <div className="grid gap-tight md:col-span-2">
                <Field
                  label="Description"
                  htmlFor="spec-textarea"
                  hint="Optional. What the mark is trying to say."
                >
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="A compass rose reduced to its northern point…"
                  />
                </Field>
                <CharCount value={notes} max={180} />
              </div>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Surfaces
           * ---------------------------------------------------------- */}
          <Section
            title="Surfaces"
            note="Hairline borders and space. There are no shadows on a panel — depth is reserved for things that genuinely float."
          >
            <div className="grid gap-roomy">
              <Panel>
                <PanelHeader
                  eyebrow="Round 3"
                  title="Standings"
                  description="Live tallies update as ballots are counted. Positions are final only once the window closes."
                  actions={
                    <>
                      <Button size="sm" variant="ghost">
                        Export
                      </Button>
                      <Button size="sm" variant="secondary">
                        Refresh
                      </Button>
                    </>
                  }
                />
                <Divider />
                <p className="max-w-measure text-body text-ink-muted">
                  Panel content sits below the header, separated by a divider rather than a nested card.
                  This is the pattern for every boxed region in the app.
                </p>
              </Panel>

              <div className="grid gap-roomy md:grid-cols-2">
                <Panel as="section">
                  <PanelHeader title="Panel as section" description="Renders a <section> element." />
                </Panel>
                <Panel as="article">
                  <PanelHeader title="Panel as article" description="Renders an <article> element." />
                </Panel>
              </div>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Badges
           * ---------------------------------------------------------- */}
          <Section
            title="Badges"
            note="Tone is carried by a wash, a hairline and a dot — never by the text colour alone. The label always says what the state is, so the badge still reads with colour removed."
          >
            <div className="flex flex-wrap items-center gap-snug">
              {BADGE_TONES.map((item) => (
                <Badge key={item.tone} tone={item.tone}>
                  {item.label}
                </Badge>
              ))}
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Stats
           * ---------------------------------------------------------- */}
          <Section title="Stats" note="The dashboard numbers. Digits are tabular so columns do not jitter as counts tick up.">
            <Panel>
              <div className="grid gap-roomy sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Entries" value={24} hint="3 added today" />
                <Stat label="Ballots cast" value={112} hint="of 180 eligible" />
                <Stat label="Turnout" value="62%" hint="Quorum is 50%" />
                <Stat label="Rounds" value={4} hint="Counting complete" />
              </div>
            </Panel>
          </Section>

          {/* -------------------------------------------------------------
           * Absence and loading
           * ---------------------------------------------------------- */}
          <Section
            title="Absence and loading"
            note="An empty ballot is not an error. Dashed hairline, muted type, nothing red, no alert role."
          >
            <div className="grid gap-roomy">
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title="No entries yet"
                description="Submissions open when the window does. You will be able to upload up to three logos, and change them right up to the deadline."
                action={<Button variant="primary">Notify me when it opens</Button>}
              />

              <EmptyState
                title="Your ballot is empty"
                description="Drag entries into the five ranked slots, or use the number keys."
              />

              <Panel>
                <PanelHeader title="Skeleton" description="Shown while entries load. Hidden from assistive tech." />
                <Divider />
                <div className="grid gap-base sm:grid-cols-3">
                  {[0, 1, 2].map((key) => (
                    <div key={key} className="grid gap-tight">
                      <Skeleton className="aspect-square h-auto w-full rounded" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
                <Divider />
                <div className="flex items-center gap-snug">
                  <Spinner />
                  <span className="text-sm text-ink-muted">
                    Spinner — the &ldquo;Loading&rdquo; label is the accessible name, not painted on screen.
                  </span>
                </div>
              </Panel>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Tabs and switches
           * ---------------------------------------------------------- */}
          <Section
            title="Tabs and switches"
            note="Both are thin wrappers over Radix. The current tab is marked by an accent underline and darker ink, not by colour alone; a switch is read by thumb position as much as by fill."
          >
            <div className="grid gap-roomy">
              <Panel>
                <Tabs defaultValue="entries">
                  <TabsList>
                    <TabsTrigger value="entries">Entries</TabsTrigger>
                    <TabsTrigger value="ballots">Ballots</TabsTrigger>
                    <TabsTrigger value="audit">Audit log</TabsTrigger>
                    <TabsTrigger value="locked" disabled>
                      Results
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="entries">
                    <p className="max-w-measure text-body text-ink-muted">
                      24 entries, 3 withdrawn. Arrow keys move between tabs — Radix owns the roving tab
                      stop.
                    </p>
                  </TabsContent>
                  <TabsContent value="ballots">
                    <p className="max-w-measure text-body text-ink-muted">
                      112 ballots cast of 180 eligible.
                    </p>
                  </TabsContent>
                  <TabsContent value="audit">
                    <p className="max-w-measure text-body text-ink-muted">
                      Every moderation action is recorded with an actor and a timestamp.
                    </p>
                  </TabsContent>
                  <TabsContent value="locked">
                    <p className="max-w-measure text-body text-ink-muted">
                      Unavailable until counting closes.
                    </p>
                  </TabsContent>
                </Tabs>
              </Panel>

              <Panel>
                <PanelHeader
                  title="Contest phases"
                  description="Admin toggles. Each switch is paired with a real label."
                />
                <Divider />
                <div className="grid gap-base">
                  <div className="flex items-center justify-between gap-base">
                    <Label htmlFor="spec-switch-submissions">Submissions open</Label>
                    <Switch
                      id="spec-switch-submissions"
                      checked={submissionsOpen}
                      onCheckedChange={setSubmissionsOpen}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-base">
                    <Label htmlFor="spec-switch-overlap">Allow voting to overlap submissions</Label>
                    <Switch
                      id="spec-switch-overlap"
                      checked={overlapWindows}
                      onCheckedChange={setOverlapWindows}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-base">
                    <Label htmlFor="spec-switch-disabled" className="text-ink-subtle">
                      Publish results (locked until counting ends)
                    </Label>
                    <Switch id="spec-switch-disabled" checked={false} disabled />
                  </div>
                </div>
              </Panel>
            </div>
          </Section>

          {/* -------------------------------------------------------------
           * Countdown
           * ---------------------------------------------------------- */}
          <Section
            title="Countdown"
            note="Anchored to server time taken at page load, then advanced locally. A browser clock that is twenty minutes fast does not move the deadline. The visible text ticks every second and is hidden from screen readers; a polite live region carries a coarser string that changes at most once a minute."
          >
            <Panel>
              <div className="grid gap-base">
                <div className="flex flex-wrap items-baseline justify-between gap-snug border-b border-line pb-base">
                  <span className="text-sm text-ink-muted">Two days out — words</span>
                  <Countdown
                    to={clock.inDays}
                    serverNow={clock.serverNow}
                    className="font-display text-display-sm text-ink"
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-snug border-b border-line pb-base">
                  <span className="text-sm text-ink-muted">Under a day — clock</span>
                  <Countdown
                    to={clock.inHours}
                    serverNow={clock.serverNow}
                    className="font-display text-display-sm text-ink"
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-snug border-b border-line pb-base">
                  <span className="text-sm text-ink-muted">Under an hour — minutes and seconds</span>
                  <Countdown
                    to={clock.inMinutes}
                    serverNow={clock.serverNow}
                    className="font-display text-display-sm text-warning"
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-snug">
                  <span className="text-sm text-ink-muted">Deadline passed</span>
                  <Countdown
                    to={clock.past}
                    serverNow={clock.serverNow}
                    expired={<Badge tone="neutral">Voting closed</Badge>}
                  />
                </div>
              </div>
            </Panel>
          </Section>

          {/* -------------------------------------------------------------
           * Dialogs
           * ---------------------------------------------------------- */}
          <Section
            title="Confirmation dialogs"
            note="Radix underneath: focus trap, focus restore, Escape and scroll lock. The destructive variant opens with focus on Cancel rather than on the irreversible action."
          >
            <div className="flex flex-wrap items-center gap-snug">
              <Button variant="primary" onClick={() => setConfirmOpen(true)}>
                Cast ballot…
              </Button>
              <Button variant="danger" onClick={() => setDestructiveOpen(true)}>
                Withdraw entry…
              </Button>
            </div>

            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Cast your ballot?"
              description="Your ranking is final once submitted. You can see the result when counting closes, but you will not be able to change your ranking."
              confirmLabel="Cast ballot"
              onConfirm={() => {
                // Specimen only — a real screen would await the API here.
              }}
            />

            <ConfirmDialog
              open={destructiveOpen}
              onOpenChange={setDestructiveOpen}
              title="Withdraw this entry?"
              description="The logo is removed from the gallery immediately and cannot be restored. Any ballots already ranking it will be recounted."
              confirmLabel="Withdraw entry"
              cancelLabel="Keep entry"
              destructive
              onConfirm={() => {
                // Specimen only.
              }}
            />
          </Section>

          {/* -------------------------------------------------------------
           * Entry frames
           * ---------------------------------------------------------- */}
          <Section
            title="Entry frames"
            note="Every logo is presented identically — same aspect, same padding, same ground, same hairline — so presentation never advantages an entry. Aliases stand in for names while voting is open."
          >
            <ul className="grid list-none grid-cols-2 gap-base p-0 sm:grid-cols-3">
              {MARKS.map((entry, index) => (
                <li key={entry.alias} className="grid gap-tight">
                  <div className="entry-frame p-roomy">{entry.mark}</div>
                  <div className="flex items-baseline justify-between gap-tight">
                    <span className="text-sm text-ink">{entry.alias}</span>
                    <span className="text-xs text-ink-subtle" data-tabular>
                      #{String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {/* -------------------------------------------------------------
           * Palette
           * ---------------------------------------------------------- */}
          <Section
            title="Palette"
            note="The whole of it. Tailwind's stock palette is replaced rather than extended, so a stock blue is not reachable from a utility class at all — which is the only reliable way to stop the restraint evaporating one class at a time."
          >
            <div className="grid grid-cols-2 gap-base sm:grid-cols-4 lg:grid-cols-6">
              {[
                { name: 'paper', className: 'bg-paper' },
                { name: 'paper-raised', className: 'bg-paper-raised' },
                { name: 'paper-sunken', className: 'bg-paper-sunken' },
                { name: 'line', className: 'bg-line' },
                { name: 'line-strong', className: 'bg-line-strong' },
                { name: 'ink-faint', className: 'bg-ink-faint' },
                { name: 'ink-subtle', className: 'bg-ink-subtle' },
                { name: 'ink-muted', className: 'bg-ink-muted' },
                { name: 'ink', className: 'bg-ink' },
                { name: 'accent', className: 'bg-accent' },
                { name: 'accent-hover', className: 'bg-accent-hover' },
                { name: 'accent-active', className: 'bg-accent-active' },
                { name: 'accent-soft', className: 'bg-accent-soft' },
                { name: 'danger', className: 'bg-danger' },
                { name: 'danger-soft', className: 'bg-danger-soft' },
                { name: 'success', className: 'bg-success' },
                { name: 'success-soft', className: 'bg-success-soft' },
                { name: 'warning', className: 'bg-warning' },
                { name: 'warning-soft', className: 'bg-warning-soft' },
              ].map((swatch) => (
                <div key={swatch.name} className="grid gap-tight">
                  <div className={`h-12 w-full rounded border border-line ${swatch.className}`} />
                  <span className="font-mono text-xs text-ink-muted">{swatch.name}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <hr className="rule mt-section" />
        <p className="mt-base text-xs text-ink-subtle">
          Media Moguls (North 7) — style gallery. Accent currently set to{' '}
          <strong className="font-medium text-ink">{accent}</strong>.
        </p>
      </div>
    </div>
  );
}
