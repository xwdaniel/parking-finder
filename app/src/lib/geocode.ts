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

// --- Current-location fix (brief §10 step 14 / GPS-denial path) ----------------

export type CurrentLocationFailure =
  | 'permission_denied' // user said no in the OS prompt — show the manual-search hint
  | 'unavailable'; // location services off / hardware error / timeout

export type CurrentLocationResult =
  | { ok: true; place: PlaceSuggestion }
  | { ok: false; reason: CurrentLocationFailure };

/**
 * Ask the OS for the device's current location and turn it into a `PlaceSuggestion`
 * usable as a destination. Never throws — failures (denied, timeout, services off)
 * come back as `{ ok: false, reason }` so the caller can render a fallback hint.
 *
 * No background-location use; foreground-only. The reverse-geocoded street label is
 * a *nice-to-have* — if it fails, we still return a usable lat/lng with a generic
 * "Current location" label, so the search still works.
 */
export async function getCurrentLocationPlace(): Promise<CurrentLocationResult> {
  // Don't re-prompt if the user has already declined — read first, request only when needed.
  let status: Location.LocationPermissionResponse;
  try {
    status = await Location.getForegroundPermissionsAsync();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!status.granted) {
    if (!status.canAskAgain) return { ok: false, reason: 'permission_denied' };
    try {
      status = await Location.requestForegroundPermissionsAsync();
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (!status.granted) return { ok: false, reason: 'permission_denied' };
  }

  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  let label = 'Current location';
  try {
    const [addr] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    if (addr) {
      const formatted = formatAddress(addr);
      if (formatted) label = formatted;
    }
  } catch {
    // keep the generic label
  }

  return {
    ok: true,
    place: {
      id: `here:${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`,
      label,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    },
  };
}
