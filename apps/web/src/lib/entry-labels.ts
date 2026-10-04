/**
 * How an entry is named in the UI.
 *
 * Centralised for one reason: this is the last place a name could leak. Every
 * caption, alt text and aria-label in the gallery routes through here, so
 * there is exactly one function to audit rather than a dozen template literals
 * scattered across two pages.
 *
 * `PublicSubmissionDto` carries no uploader field, so there is nothing here to
 * leak — but the day someone adds one, this is the file that must not change.
 */

import type { PublicSubmissionDto } from '@contest/shared';

/**
 * "Entry 07", or a neutral placeholder.
 *
 * The alias is null until submissions close: aliases are assigned by shuffle
 * at that moment precisely so the numbering cannot be read as upload order.
 * Falling back to the array index would reintroduce exactly the leak the
 * shuffle exists to prevent, so an unnumbered entry stays unnumbered.
 */
export function entryLabel(entry: Pick<PublicSubmissionDto, 'alias'>): string {
  return entry.alias ?? 'Entry';
}

/**
 * Alt text. Describes the entry, never the person: "Entry 07" and whatever
 * title they chose is all anyone — sighted or not — gets to know.
 */
export function entryAlt(entry: Pick<PublicSubmissionDto, 'alias' | 'title'>): string {
  const label = entryLabel(entry);
  return entry.title ? `${label}: ${entry.title}` : `${label}, logo design`;
}

/** Accessible name for the tile button, including the "yours" state. */
export function entryTileLabel(entry: Pick<PublicSubmissionDto, 'alias' | 'title' | 'isMine'>): string {
  const base = entryAlt(entry);
  return entry.isMine ? `${base}. Your entry. Open larger view` : `${base}. Open larger view`;
}
