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

// Mapbox public access token (pk.*), wired via app.config.ts ← EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
// (see app/.env.example). When unset, MapResultsScreen renders without the map.
const rawMapboxToken = (extra.mapboxAccessToken as string | undefined)?.trim();
export const MAPBOX_ACCESS_TOKEN = rawMapboxToken && rawMapboxToken.length > 0 ? rawMapboxToken : null;
export const HAS_MAPBOX = MAPBOX_ACCESS_TOKEN !== null;
