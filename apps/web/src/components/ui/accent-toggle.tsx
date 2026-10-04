/**
 * Accent switcher.
 *
 * The whole palette hangs off `data-accent` on <html>, so swapping it repaints
 * every accent surface in the app with no rebuild and no re-render.
 *
 * State lives in a tiny module-level store rather than a context, because the
 * published API is a bare `useAccent()` hook with no provider to wrap the tree
 * in. `useSyncExternalStore` keeps every mounted toggle in agreement, and a
 * `storage` listener keeps separate tabs in agreement too.
 *
 * The swatches are the neat part: each one carries its own `data-accent`, so
 * the bronze dot resolves `--accent` to bronze and the teal dot resolves it to
 * teal, live, straight from the token file. No colour is restated here.
 */

import { useCallback, useId, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

export type Accent = 'bronze' | 'teal';

const STORAGE_KEY = 'north7:accent';
// Deep teal, chosen 2026-09-13 for its stronger separation from the warm
// paper background — primary actions read unambiguously as actions. Must stay
// in step with the `:root` block in styles/tokens.css, which is also teal, so
// the first paint matches what this store reports.
const DEFAULT_ACCENT: Accent = 'teal';

const isAccent = (value: unknown): value is Accent => value === 'bronze' || value === 'teal';

let current: Accent = DEFAULT_ACCENT;
let initialised = false;
const listeners = new Set<() => void>();

function readStored(): Accent {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAccent(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    // Private mode, blocked storage — the default is a perfectly good answer.
    return DEFAULT_ACCENT;
  }
}

function paint(accent: Accent): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['accent'] = accent;
}

function ensureInitialised(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  current = readStored();
  paint(current);
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  ensureInitialised();
  listeners.add(listener);

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    const next = isAccent(event.newValue) ? event.newValue : DEFAULT_ACCENT;
    if (next === current) return;
    current = next;
    paint(current);
    emit();
  };

  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const getSnapshot = (): Accent => current;

function setAccentGlobal(accent: Accent): void {
  if (accent === current) return;
  current = accent;
  paint(accent);
  try {
    window.localStorage.setItem(STORAGE_KEY, accent);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
  emit();
}

export function useAccent(): { accent: Accent; setAccent: (a: Accent) => void } {
  const accent = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_ACCENT);
  const setAccent = useCallback((a: Accent) => setAccentGlobal(a), []);
  return { accent, setAccent };
}

const OPTIONS: ReadonlyArray<{ value: Accent; label: string }> = [
  { value: 'bronze', label: 'Bronze' },
  { value: 'teal', label: 'Teal' },
];

/**
 * Two native radios in a segmented control. Native radios are used on purpose:
 * arrow-key navigation, the roving tab stop and label association all come for
 * free and correct. The input is visually hidden, so the focus ring is
 * forwarded to the label rather than lost.
 */
export function AccentToggle(): JSX.Element {
  const { accent, setAccent } = useAccent();
  const groupId = useId();

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="eyebrow mb-tight">Accent</legend>
      <div className="inline-flex items-center gap-hair rounded-full border border-line bg-paper-sunken p-hair">
        {OPTIONS.map((option) => {
          const id = `${groupId}-${option.value}`;
          const checked = accent === option.value;
          return (
            <span key={option.value} className="contents">
              <input
                type="radio"
                id={id}
                name={groupId}
                value={option.value}
                checked={checked}
                onChange={() => setAccent(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'inline-flex cursor-pointer select-none items-center gap-tight rounded-full border px-snug py-hair',
                  'font-sans text-xs font-medium transition-colors',
                  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                  checked
                    ? 'border-line-strong bg-paper-raised text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {/* Resolves --accent within its own scope: a live token swatch. */}
                <span
                  data-accent={option.value}
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-accent"
                />
                {option.label}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
