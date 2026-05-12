import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

// Backend base URL. Set per-environment via app.json `extra.apiBaseUrl`
// (the Fly.io URL goes here once the backend is deployed).
export const API_BASE_URL = (extra.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

// Google Places API key (for destination autocomplete). Optional: when unset, the
// destination input falls back to Apple's on-device geocoder (see src/lib/geocode.ts).
// To enable Google: create a Google Cloud project, enable the "Places API", create an
// API key, and put it in app.json `extra.googlePlacesApiKey` (or a local override).
const rawGoogleKey = (extra.googlePlacesApiKey as string | undefined)?.trim();
export const GOOGLE_PLACES_API_KEY = rawGoogleKey && rawGoogleKey.length > 0 ? rawGoogleKey : null;
export const HAS_GOOGLE_PLACES = GOOGLE_PLACES_API_KEY !== null;
