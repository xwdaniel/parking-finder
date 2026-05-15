import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { listOutcomes, listSearches, getPendingPick } from '../lib/log/log';
import type { OutcomeRow } from '../lib/log/types';

// React Query bindings for the personal log (brief §7). Cheap reads — the log is
// local SQLite, no network. We use react-query mainly to share state across screens
// and invalidate consistently after a write (recordOutcome / recordPick).

const OUTCOMES_KEY = ['log', 'outcomes'] as const;
const SEARCHES_KEY = ['log', 'searches'] as const;
const PENDING_PICK_KEY = ['log', 'pendingPick'] as const;

/** Every outcome row, indexed by zone_id. Refetched cheaply after a write. */
export function useOutcomes() {
  return useQuery({
    queryKey: OUTCOMES_KEY,
    queryFn: listOutcomes,
    staleTime: 60_000,
  });
}

export function useSearches(limit = 50) {
  return useQuery({
    queryKey: [...SEARCHES_KEY, limit],
    queryFn: () => listSearches(limit),
    staleTime: 60_000,
  });
}

export function usePendingPick(maxAgeMs?: number) {
  return useQuery({
    queryKey: [...PENDING_PICK_KEY, maxAgeMs ?? 'default'],
    queryFn: () => getPendingPick(maxAgeMs),
    // Pending picks should update promptly when the user comes back from Maps.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Returns a stable callback that invalidates all log-derived queries — call after any write. */
export function useInvalidateLog(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ['log'] });
  }, [qc]);
}

/** Convenience helper: pull a single zone's override out of the result of `useOutcomes()`. */
export function pickOutcome(outcomes: Map<string, OutcomeRow> | undefined, zoneId: string): OutcomeRow | null {
  if (!outcomes) return null;
  return outcomes.get(zoneId) ?? null;
}
