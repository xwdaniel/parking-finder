import { useQuery } from '@tanstack/react-query';

import { fetchTransitSearch, type TransitSearchQuery, type TransitSearchResponse } from '../lib/api';

/**
 * Ranked Park+Tube candidates (brief §5.2, build-order step 10). Like useWalkSearch
 * but also keyed on `timeMode` + `includeBus` because both change the TfL journey
 * (Departing vs Arriving, and which transit modes are searched).
 */
export function useTransitSearch(q: TransitSearchQuery, enabled = true) {
  return useQuery<TransitSearchResponse>({
    queryKey: ['search', 'transit', q.destination.lat, q.destination.lng, q.maxWalkMinutes, q.timeMode, q.t ?? null, q.includeBus],
    queryFn: ({ signal }) => fetchTransitSearch(q, signal),
    enabled,
    // Slightly longer than walk: TfL Journey is the expensive bit and our server already
    // caches per (zone-point, dest, 5-min bucket) — see brief §9.
    staleTime: 90_000,
  });
}
