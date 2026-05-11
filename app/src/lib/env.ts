import Constants from 'expo-constants';

// Backend base URL. Set per-environment via app.json `extra.apiBaseUrl`
// (Step 2 wires the Fly.io URL once the backend skeleton is deployed).
export const API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';
