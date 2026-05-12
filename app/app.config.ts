import type { ConfigContext, ExpoConfig } from 'expo/config';

// Dynamic config — layers the Mapbox tokens (from app/.env, gitignored) onto app.json:
//   • EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN  → extra.mapboxAccessToken (the public `pk.*` token,
//     read at runtime by src/lib/env.ts → Mapbox.setAccessToken).
//   • MAPBOX_DOWNLOAD_TOKEN            → @rnmapbox/maps config plugin (a *secret* token with
//     the Downloads:Read scope, used at prebuild to fetch the native Mapbox SDK).
// Both are optional: with neither set the app still bundles and MapResultsScreen renders a
// no-map fallback. `expo` auto-loads .env before evaluating this file. See app/.env.example.
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const downloadToken = process.env.MAPBOX_DOWNLOAD_TOKEN;

  const plugins: NonNullable<ExpoConfig['plugins']> = [...(base.plugins ?? [])];
  if (downloadToken) {
    const mapboxPlugin: [string, Record<string, unknown>] = ['@rnmapbox/maps', { RNMapboxMapsDownloadToken: downloadToken }];
    plugins.push(mapboxPlugin);
  }

  return {
    ...base,
    plugins,
    extra: {
      ...(base.extra ?? {}),
      mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '',
    },
  };
};
