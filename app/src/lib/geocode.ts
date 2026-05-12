import * as Location from 'expo-location';

/** A picked destination — what the Search screen needs from any address-lookup source. */
export interface PlaceSuggestion {
  /** Stable-ish id for list keys (provider id, or a synthesised one). */
  id: string;
  /** Human-readable label shown in the list and as the chosen-destination pill. */
  label: string;
  latitude: number;
  longitude: number;
}

/**
 * Fallback destination lookup using Apple's on-device geocoder (via expo-location) —
 * used when no Google Places API key is configured. Forward-geocodes the query, then
 * reverse-geocodes each hit for a tidy label. Forward/reverse geocoding does NOT need
 * the location permission (it's address↔coords translation, not device positioning).
 *
 * iOS limits geocoding request rate; callers should debounce. Returns [] on any error.
 */
export async function searchPlacesApple(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  let coords: Location.LocationGeocodedLocation[];
  try {
    coords = await Location.geocodeAsync(q);
  } catch {
    return [];
  }
  if (signal?.aborted) return [];

  const top = coords.slice(0, 5);
  const out = await Promise.all(
    top.map(async (c, i): Promise<PlaceSuggestion> => {
      let label = q;
      try {
        const [addr] = await Location.reverseGeocodeAsync({ latitude: c.latitude, longitude: c.longitude });
        if (addr) label = formatAddress(addr) || q;
      } catch {
        // keep the typed query as the label
      }
      return { id: `apple:${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}:${i}`, label, latitude: c.latitude, longitude: c.longitude };
    }),
  );
  if (signal?.aborted) return [];

  // De-dupe identical labels (the geocoder occasionally returns near-duplicates).
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.label) ? false : (seen.add(p.label), true)));
}

function formatAddress(a: Location.LocationGeocodedAddress): string {
  const line1 = [a.streetNumber, a.street ?? a.name].filter(Boolean).join(' ');
  const parts = [line1 || a.name, a.city ?? a.subregion, a.postalCode].filter((p): p is string => !!p && p.trim().length > 0);
  // collapse exact repeats (e.g. name === street)
  return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
}
