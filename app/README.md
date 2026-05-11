# ParkFree — iOS app (Expo managed workflow)

Step 1 of the build order in `../ParkFree_ClaudeCode_Brief.md` §10. iOS only (managed workflow + config plugins; `expo prebuild` for native config).

## Layout

```
app/
  App.tsx                 # providers: GestureHandlerRootView → SafeAreaProvider → QueryClient → NavigationContainer
  index.ts                # registerRootComponent(App)
  app.json                # Expo config — iOS-only, bundle id, location permission, comgooglemaps query scheme
  babel.config.js         # babel-preset-expo + react-native-reanimated/plugin (last)
  src/
    navigation/
      types.ts            # SearchParams + param lists
      RootNavigator.tsx   # bottom tabs: [Park = stack(Search → MapResults)] [Log]
    screens/
      SearchScreen.tsx        # placeholder — controls land in Step 7
      MapResultsScreen.tsx    # placeholder — Mapbox map (Step 8) + bottom sheet (Step 9)
      LogScreen.tsx           # placeholder — expo-sqlite personal log (Step 13)
    lib/
      queryClient.ts      # shared @tanstack/react-query client
      env.ts              # API_BASE_URL (wired to Fly.io in Step 2)
```

## Running

```bash
cd app
npm install
npx expo install --fix     # reconcile any version drift with the installed Expo SDK

# Dev client (recommended — needed once native modules like @rnmapbox/maps are added):
npm run prebuild           # expo prebuild --platform ios --clean
npm run ios                # build + run on a connected iPhone / simulator

# Or, while there are no custom native modules, plain Expo Go also works:
npm run start:go
```

`@react-navigation/*`, `react-native-screens`, `react-native-safe-area-context`,
`react-native-gesture-handler`, `react-native-reanimated`, and `@gorhom/bottom-sheet`
are installed now so the navigation shell works and later steps don't re-trigger installs.

## Not yet wired (by design — see brief §10)

- **Mapbox** (`@rnmapbox/maps`) — added in **Step 8**. Needs the config plugin in `app.json`:
  `["@rnmapbox/maps", { "RNMapboxMapsDownloadToken": "sk.…" }]`, a `MAPBOX_ACCESS_TOKEN` at
  runtime, and a secret download token in the build environment.
- **Google Places autocomplete** — Step 7.
- **TfL Journey API** — backend-side, Step 10.
- **expo-sqlite personal log** — Step 13. `expo-sqlite` is installed but unused.
- **Offline React Query persistence** — Step 14.

## Distribution reminder (brief §8)

Free Apple ID + Personal Team signing → **7-day provisioning expiry**. Sunday-evening
calendar reminder: connect the iPhone, `npm run ios`, ~2 minutes. No TestFlight / App Store.
