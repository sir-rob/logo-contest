/**
 * The anonymous gallery.
 *
 * Design rule, and the reason this file is so plain: an even grid of identical
 * frames. No per-entry shadow, no hover-scale, no featured tile, no varying
 * size. Anything that makes one entry look more considered than another is a
 * thumb on the scale of a vote, so the visual hierarchy stops at the frame.
 *
 * Anonymity is structural, not enforced here: `PublicSubmissionDto` has no
 * uploader field to render. `isMine` is the single exception, and it is true
 * only for the caller's own entry — it can identify the person already reading
 * the screen and nobody else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Lock, RefreshCw } from 'lucide-react';
import { canSubmit, canViewGallery, type PublicSubmissionDto } from '@contest/shared';
import { api } from '@/lib/api';
import { entryLabel, entryTileLabel } from '@/lib/entry-labels';
import { plural } from '@/lib/utils';
import { EntryFrame } from '@/components/EntryFrame';
import { EntryLightbox } from '@/components/EntryLightbox';
import { Badge, Button, EmptyState, PageHeader, Skeleton } from '@/components/ui';

/** One grid, defined once, so skeletons and tiles can never disagree. */
const GRID_CLASS = 'grid grid-cols-2 gap-base sm:grid-cols-3 sm:gap-roomy xl:grid-cols-4';

export function Gallery(): JSX.Element {
  const navigate = useNavigate();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const contestQuery = useQuery({ queryKey: ['contest'], queryFn: api.contest });
  const phase = contestQuery.data?.phase;
  const galleryVisible = phase ? canViewGallery(phase) : false;
  const submissionsOpen = phase ? canSubmit(phase) : false;

  const entriesQuery = useQuery({
    queryKey: ['submissions'],
    queryFn: api.submissions,
    // Nothing to fetch while the gallery is sealed; asking would only 403.
    enabled: galleryVisible,
  });

  const entries = useMemo<PublicSubmissionDto[]>(() => entriesQuery.data ?? [], [entriesQuery.data]);

  // A refetch that drops the open entry (withdrawn mid-view) must not leave the
  // lightbox pointing past the end of the array.
  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= entries.length) setLightboxIndex(null);
  }, [entries.length, lightboxIndex]);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const aliasesAssigned = entries.some((entry) => entry.alias !== null);

  return (
    <div className="space-y-loose">
      <PageHeader
        eyebrow="Media Moguls · North 7"
        title="Entries"
        description={
          galleryVisible && entries.length > 0
            ? `${plural(entries.length, 'entry', 'entries')}, shown anonymously and in the same frame.`
            : 'Every logo, shown anonymously and in the same frame.'
        }
        actions={
          submissionsOpen ? (
            <Button variant="secondary" onClick={() => navigate('/submit')}>
              Your entry
            </Button>
          ) : undefined
        }
      />

      {/* Phase SETUP: the gallery does not exist yet, and saying so is kinder
          than an empty grid that looks broken. */}
      {contestQuery.isSuccess && !galleryVisible ? (
        <EmptyState
          icon={<Lock aria-hidden="true" className="h-5 w-5" />}
          title="The gallery is not open yet."
          description="Entries appear here as soon as submissions open. Nothing is shown before then, so nobody sees an early idea before the rest."
        />
      ) : null}

      {contestQuery.isError ? (
        <EmptyState
          icon={<RefreshCw aria-hidden="true" className="h-5 w-5" />}
          title="Could not load the contest."
          description="Something went wrong reaching the server. Your entry is safe."
          action={
            <Button variant="secondary" onClick={() => void contestQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {/* Skeletons use the same grid and the same square frame, so nothing
          shifts when the real tiles land. */}
      {contestQuery.isPending || (galleryVisible && entriesQuery.isPending) ? (
        <GallerySkeleton />
      ) : null}

      {galleryVisible && entriesQuery.isError ? (
        <EmptyState
          icon={<RefreshCw aria-hidden="true" className="h-5 w-5" />}
          title="Could not load the entries."
          description="That is a problem at our end, not with your connection to the contest."
          action={
            <Button variant="secondary" onClick={() => void entriesQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {galleryVisible && entriesQuery.isSuccess && entries.length === 0 ? (
        <EmptyState
          icon={<ImageOff aria-hidden="true" className="h-5 w-5" />}
          title="No entries yet."
          description={
            submissionsOpen
              ? 'Nobody has uploaded an entry yet. Being first is not a disadvantage — entries are shuffled and numbered only once submissions close.'
              : 'No entries were submitted for this contest.'
          }
          action={
            submissionsOpen ? <Button onClick={() => navigate('/submit')}>Add your entry</Button> : undefined
          }
        />
      ) : null}

      {galleryVisible && entries.length > 0 ? (
        <>
          {!aliasesAssigned ? (
            <p className="text-xs text-ink-subtle">
              Entry numbers are assigned in a shuffled order when submissions close, so the numbering never
              reveals who uploaded when.
            </p>
          ) : null}

          <ul role="list" className={GRID_CLASS}>
            {entries.map((entry, index) => (
              <li key={entry.id}>
                <EntryTile entry={entry} onOpen={() => setLightboxIndex(index)} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <EntryLightbox
        entries={entries}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={closeLightbox}
      />
    </div>
  );
}

/**
 * One tile.
 *
 * The whole tile is a single button — one tab stop per entry, so tabbing
 * through a gallery of forty logos takes forty presses rather than eighty. The
 * focus ring is drawn on the tile rather than inside it, which is the only
 * visual difference any tile is ever allowed to have.
 */
function EntryTile({
  entry,
  onOpen,
}: {
  entry: PublicSubmissionDto;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={entryTileLabel(entry)}
      className="block w-full rounded text-left"
    >
      <EntryFrame src={entry.thumbUrl} alt="" />

      <div className="mt-snug flex items-center justify-between gap-2">
        <span className="font-sans text-sm text-ink" data-tabular>
          {entryLabel(entry)}
        </span>
        {/* Quiet, and it is the viewer's own entry — it identifies nobody else. */}
        {entry.isMine ? <Badge>Yours</Badge> : null}
      </div>

      {entry.title ? <p className="mt-hair truncate text-xs text-ink-muted">{entry.title}</p> : null}
    </button>
  );
}

function GallerySkeleton(): JSX.Element {
  return (
    <>
      {/* The tiles are decorative placeholders; the status carries the meaning. */}
      <span className="sr-only" role="status">
        Loading entries
      </span>
      <div className={GRID_CLASS} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index}>
            <Skeleton className="aspect-square w-full rounded" />
            <Skeleton className="mt-snug h-4 w-20" />
          </div>
        ))}
      </div>
    </>
  );
}

export default Gallery;
