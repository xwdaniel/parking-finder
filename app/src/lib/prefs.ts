import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SearchMode, TimeMode } from '../navigation/types';

// Cold-start search defaults (brief §10 step 14).
// Persisted in AsyncStorage under a versioned key — keeps the previous-trip's mode /
// walk-radius / bus toggle sticky so the user doesn't reconfigure the same prefs every
// time the app cold-starts. The destination itself is *not* persisted — re-opening
// the app onto last-trip's destination would be wrong as often as it'd be right.

const KEY = 'parkfree.prefs-v1';

export interface Prefs {
  mode: SearchMode;
  timeMode: TimeMode;
  maxWalkMinutes: number;
  includeBus: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  mode: 'walk',
  timeMode: 'now',
  maxWalkMinutes: 10, // brief §4
  includeBus: false,
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...sanitise(parsed) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(p: Prefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* best-effort */
  }
}

function sanitise(raw: unknown): Partial<Prefs> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Prefs> = {};
  if (r.mode === 'walk' || r.mode === 'transit') out.mode = r.mode;
  if (r.timeMode === 'now' || r.timeMode === 'arrive_by') out.timeMode = r.timeMode;
  if (typeof r.maxWalkMinutes === 'number' && r.maxWalkMinutes >= 2 && r.maxWalkMinutes <= 30) {
    out.maxWalkMinutes = Math.round(r.maxWalkMinutes);
  }
  if (typeof r.includeBus === 'boolean') out.includeBus = r.includeBus;
  return out;
}
