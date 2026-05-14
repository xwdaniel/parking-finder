import { useQuery } from '@tanstack/react-query';

import { fetchWalkSearch, type WalkPoint, type WalkSearchResponse } from '../lib/api';

/**
 * Ranked walk-mode candidates for the bottom-sheet list (brief §5.1, step 9).
 * The query is parameterised by the destination, the slider value, and the arrival
 * time — exactly the four bits the Search screen captured. No bbox-snap business
 * here: the destination is a fixed user pick for the lifetime of the screen.
 */
export function useWalkSearch(destination: WalkPoint, maxWalkMinutes: number, t: string | null | undefined, enabled = true) {
  return useQuery<WalkSearchResponse>({
    queryKey: ['search', 'walk', destination.lat, destination.lng, maxWalkMinutes, t ?? null],
    queryFn: ({ signal }) => fetchWalkSearch({ destination, maxWalkMinutes, t }, signal),
    enabled,
    staleTime: 60_000,
  });
}
