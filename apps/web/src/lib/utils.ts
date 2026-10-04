import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes so a later class actually wins over an earlier one of
 * the same family. `clsx` alone would leave both `px-2` and `px-4` on the
 * element and let source order in the stylesheet decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Clamp a number into a range. Used by the standings bars. */
export const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

/** 0..1 → "43%" for display. */
export const formatPercent = (share: number, digits = 0): string =>
  `${(clamp(share, 0, 1) * 100).toFixed(digits)}%`;

/** Pluralise without dragging in an i18n library for two words. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
