import { useQuery } from '@tanstack/react-query';

import { fetchZones, type Bbox, type ZonesResponse } from '../lib/api';

/** Snap a bbox to a ~50 m grid so map-pan jitter doesn't trigger a refetch on every frame. */
function snapBbox(b: Bbox): Bbox {
  const r = (n: number) => Math.round(n * 2000) / 2000; // 0.0005° ≈ 35–55 m at London latitudes
  return [r(b[0]), r(b[1]), r(b[2]), r(b[3])];
}

/**
 * Viewport zones for the Map + Results screen. Re-queries when the (snapped) bbox or the
 * arrival time changes; React Query caches recent viewports so panning back is instant.
 */
export function useZones(bbox: Bbox | null, t: string | null | undefined, enabled = true) {
  const snapped = bbox ? snapBbox(bbox) : null;
  return useQuery<ZonesResponse>({
    queryKey: ['zones', snapped, t ?? null],
    queryFn: ({ signal }) => fetchZones({ bbox: snapped as Bbox, t }, signal),
    enabled: enabled && snapped !== null,
    staleTime: 60_000,
  });
}
