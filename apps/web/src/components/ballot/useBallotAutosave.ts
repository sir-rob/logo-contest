/**
 * Debounced autosave for the ballot.
 *
 * The contract this hook exists to keep: a change the voter made is never
 * silently lost. If a save fails the local ranking stays exactly as they left
 * it, the status goes to `error`, and `saveNow()` retries the same thing. We
 * never roll the UI back to the server's version behind their back.
 *
 * Two other details worth knowing:
 *  - An empty ranking is not an empty save. `SaveBallotSchema` requires at
 *    least one entry, so clearing the last slot calls DELETE /ballot instead.
 *  - `pause` exists for the amendment flow. When the server tells us an entry
 *    on the ballot has gone away we stop autosaving and wait for the voter to
 *    confirm the amended ballot, rather than committing an edit they did not
 *    make.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { rankingKey, type Ranking } from './ballot-logic';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseBallotAutosaveOptions {
  /** The voter's current, local ranking. */
  ranking: Ranking;
  /** False while loading, or once voting has closed. */
  enabled: boolean;
  /** Hold off saving — used while the amendment dialog is open. */
  paused?: boolean;
  /** What the server already has, so a fresh page load does not re-save it. */
  serverRanking: Ranking | null;
  onSaved?: (ranking: string[]) => void;
  onError?: (error: ApiClientError, ranking: string[]) => void;
  debounceMs?: number;
}

export interface BallotAutosave {
  status: SaveStatus;
  lastSavedAt: Date | null;
  error: ApiClientError | null;
  /** True when the local ranking differs from what the server acknowledged. */
  isDirty: boolean;
  /** Flush immediately — the explicit Save button and the retry both call this. */
  saveNow: () => void;
  /** Accept `ranking` as the server's state without a round trip. */
  markSaved: (ranking: Ranking) => void;
}

const DEFAULT_DEBOUNCE_MS = 800;

export function useBallotAutosave(options: UseBallotAutosaveOptions): BallotAutosave {
  const {
    ranking,
    enabled,
    paused = false,
    serverRanking,
    onSaved,
    onError,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = options;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  // Refs, not state: these are read inside timers and async callbacks where a
  // stale closure would save the wrong thing.
  const rankingRef = useRef<Ranking>(ranking);
  rankingRef.current = ranking;

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /** Key of the ranking the server last acknowledged. Null until we know. */
  const savedKeyRef = useRef<string | null>(null);
  /** Does the server currently hold a ballot for this voter? Drives clear vs. save. */
  const serverHasBallotRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  // Seed from the server exactly once per distinct server value. Without this
  // the first render would look "dirty" and immediately re-save what we just
  // read back.
  const serverKey = serverRanking === null ? null : rankingKey(serverRanking);
  const seededKeyRef = useRef<string | null | undefined>(undefined);
  if (seededKeyRef.current === undefined && serverRanking !== null) {
    seededKeyRef.current = serverKey;
    savedKeyRef.current = serverKey;
    serverHasBallotRef.current = serverRanking.length > 0;
  }

  const currentKey = rankingKey(ranking);
  const isDirty = savedKeyRef.current !== null && savedKeyRef.current !== currentKey;

  const markSaved = useCallback((next: Ranking) => {
    savedKeyRef.current = rankingKey(next);
    serverHasBallotRef.current = next.length > 0;
  }, []);

  const persist = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    const snapshot = [...rankingRef.current];
    if (savedKeyRef.current === rankingKey(snapshot)) return;

    inFlightRef.current = true;
    setStatus('saving');
    setError(null);

    try {
      if (snapshot.length === 0) {
        // Nothing to clear on a ballot that was never cast; saving an empty
        // array would just earn a BALLOT_EMPTY round trip.
        if (serverHasBallotRef.current) await api.clearBallot();
      } else {
        await api.saveBallot(snapshot);
      }
      savedKeyRef.current = rankingKey(snapshot);
      serverHasBallotRef.current = snapshot.length > 0;
      setLastSavedAt(new Date());
      setStatus('saved');
      onSavedRef.current?.(snapshot);
    } catch (caught) {
      const apiError =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError('INTERNAL', 'Could not save your ballot.', 0);
      setError(apiError);
      setStatus('error');
      onErrorRef.current?.(apiError, snapshot);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const saveNow = useCallback(() => {
    clearTimer();
    void persist();
  }, [clearTimer, persist]);

  useEffect(() => {
    if (!enabled || paused) return undefined;
    if (savedKeyRef.current === null) return undefined;
    if (savedKeyRef.current === currentKey) return undefined;

    setStatus('pending');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persist();
    }, debounceMs);

    return clearTimer;
  }, [currentKey, enabled, paused, debounceMs, persist, clearTimer]);

  // A tab closing mid-debounce should not eat the edit.
  useEffect(() => clearTimer, [clearTimer]);

  return { status, lastSavedAt, error, isDirty, saveNow, markSaved };
}
