import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

// React Query persistence (brief §10 step 14 / D32).
//
// We persist `/zones`, `/search/walk`, `/search/transit`, and the personal-log queries
// to AsyncStorage so a cold start — flaky tunnel signal, killed app, etc. — opens to
// the last view's data instead of a spinner. Mutations and tab/focus refetches still
// fire on top; the cache is a *shortcut* to "last known" data, not a freshness oracle.
//
// We do NOT persist:
//   • `searchPlacesApple` results (Apple geocoder; cheap; would just bloat storage)
//   • transient query state (errors, status fields beyond data — handled by the lib)
//
// Cache budget: AsyncStorage on iOS has no hard cap but is slow above ~6 MB.
// Our serialised cache is comfortably under 1 MB even with a full /zones viewport.

export const STORAGE_KEY = 'parkfree.rq-v1';

/** TTL for persisted entries — entries older than this are discarded on restore. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: STORAGE_KEY,
  throttleTime: 1_000,
});
