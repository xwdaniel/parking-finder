import { Linking } from 'react-native';

// Drive-leg handoff (brief §4 / build-order step 12 / D15).
//
// ParkFree itself does not own the in-car experience. Once the user has picked a
// candidate, we hand the driving leg off to Google Maps (preferred — better UK
// traffic, CarPlay integration) and fall back to Apple Maps when Google Maps
// isn't installed. Both apps pick up the user's current location as the origin.
//
// `Linking.canOpenURL('comgooglemaps://...')` only returns true on iOS when
// `comgooglemaps` is declared in `LSApplicationQueriesSchemes` (see app.json) —
// otherwise iOS opaquely returns false and we'd unconditionally fall back to
// Apple Maps. Apple Maps is reached via a `maps.apple.com` Universal Link, so
// it needs no scheme registration.

/** Google Maps iOS URL scheme — driving directions to a lat/lng. */
export function googleMapsUrl(lat: number, lng: number): string {
  return `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
}

/** Apple Maps Universal Link — driving directions to a lat/lng. */
export function appleMapsUrl(lat: number, lng: number): string {
  return `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
}

/**
 * Open Google Maps with a driving route to `(lat, lng)`; if Google Maps isn't
 * installed (or the call throws), fall back to Apple Maps. Caller fires-and-forgets.
 */
export async function navigateTo(lat: number, lng: number): Promise<void> {
  const google = googleMapsUrl(lat, lng);
  const apple = appleMapsUrl(lat, lng);
  try {
    const target = (await Linking.canOpenURL(google)) ? google : apple;
    await Linking.openURL(target);
  } catch {
    // Last-resort: try Apple Maps directly — it's bundled, so this should always succeed.
    await Linking.openURL(apple).catch(() => {
      /* nothing more we can do */
    });
  }
}
