import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { DestinationInput } from '../components/DestinationInput';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { getCurrentLocationPlace, type CurrentLocationFailure, type PlaceSuggestion } from '../lib/geocode';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import type { ParkStackParamList, SearchMode, SearchParams, TimeMode } from '../navigation/types';

type Props = NativeStackScreenProps<ParkStackParamList, 'Search'>;

const WALK_MIN = 2;
const WALK_MAX = 30;

/** Default "arrive by": the next whole hour. */
function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function formatArrival(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function SearchScreen({ navigation }: Props) {
  const [place, setPlace] = useState<PlaceSuggestion | null>(null);
  const [mode, setMode] = useState<SearchMode>(DEFAULT_PREFS.mode);
  const [timeMode, setTimeMode] = useState<TimeMode>(DEFAULT_PREFS.timeMode);
  const [arrival, setArrival] = useState<Date>(nextHour);
  const [maxWalkMinutes, setMaxWalkMinutes] = useState<number>(DEFAULT_PREFS.maxWalkMinutes);
  const [includeBus, setIncludeBus] = useState<boolean>(DEFAULT_PREFS.includeBus);

  // Load the user's last-trip prefs once. We hydrate state silently — no spinner,
  // since the in-memory defaults match the disk defaults until loadPrefs resolves.
  useEffect(() => {
    let cancelled = false;
    loadPrefs().then((p) => {
      if (cancelled) return;
      setMode(p.mode);
      setTimeMode(p.timeMode);
      setMaxWalkMinutes(p.maxWalkMinutes);
      setIncludeBus(p.includeBus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = place !== null;

  // "Use my current location" button — graceful fallback when GPS is denied/off (brief §10 step 14).
  const [locating, setLocating] = useState(false);
  const [locFailure, setLocFailure] = useState<CurrentLocationFailure | null>(null);
  const onUseCurrentLocation = async () => {
    setLocFailure(null);
    setLocating(true);
    const r = await getCurrentLocationPlace();
    setLocating(false);
    if (r.ok) setPlace(r.place);
    else setLocFailure(r.reason);
  };

  const walkHint = useMemo(
    () => (mode === 'walk' ? 'from the parking spot to your destination' : 'from the parking spot to the nearest station'),
    [mode],
  );

  const onSubmit = () => {
    if (!place) return;
    Keyboard.dismiss();
    const nextPrefs: Prefs = { mode, timeMode, maxWalkMinutes, includeBus };
    void savePrefs(nextPrefs); // fire-and-forget — never block navigation on disk write
    const search: SearchParams = {
      destinationLat: place.latitude,
      destinationLng: place.longitude,
      destinationLabel: place.label,
      mode,
      timeMode,
      arrivalTime: timeMode === 'arrive_by' ? arrival.toISOString() : undefined,
      maxWalkMinutes,
      includeBus: mode === 'transit' ? includeBus : false,
    };
    navigation.navigate('MapResults', { search });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Destination — above the scrollable form so its results dropdown can overlay it */}
      <View style={styles.destWrap}>
        {place ? (
          <View style={styles.pill}>
            <Text style={styles.pinIcon}>📍</Text>
            <Text style={styles.pillLabel} numberOfLines={2}>
              {place.label}
            </Text>
            <Pressable hitSlop={8} onPress={() => setPlace(null)} accessibilityLabel="Change destination">
              <Text style={styles.pillChange}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <DestinationInput onSelect={setPlace} />
            <Pressable
              style={styles.hereButton}
              onPress={onUseCurrentLocation}
              accessibilityRole="button"
              disabled={locating}
            >
              {locating ? <ActivityIndicator size="small" /> : <Text style={styles.hereButtonIcon}>📍</Text>}
              <Text style={styles.hereButtonText}>
                {locating ? 'Finding your location…' : 'Use my current location'}
              </Text>
            </Pressable>
            {locFailure ? (
              <Text style={styles.locFailureHint}>
                {locFailure === 'permission_denied'
                  ? 'Location off — search a destination manually, or enable Location for ParkFree in Settings.'
                  : 'Couldn’t find your location — search a destination manually.'}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field label="Mode">
          <SegmentedToggle<SearchMode>
            accessibilityLabel="Search mode"
            value={mode}
            onChange={setMode}
            options={[
              { key: 'walk', label: 'Park near', hint: 'walk the rest' },
              { key: 'transit', label: 'Park + Tube', hint: 'then take transit' },
            ]}
          />
        </Field>

        <Field label="Arrival time">
          <SegmentedToggle<TimeMode>
            accessibilityLabel="Arrival time mode"
            value={timeMode}
            onChange={setTimeMode}
            options={[
              { key: 'now', label: 'Leave now' },
              { key: 'arrive_by', label: 'Arrive by' },
            ]}
          />
          {timeMode === 'arrive_by' ? (
            <View style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Arrive by {formatArrival(arrival)}</Text>
              <DateTimePicker
                value={arrival}
                mode="datetime"
                display="compact"
                minuteInterval={5}
                minimumDate={new Date()}
                onChange={(_event, d) => {
                  if (d) setArrival(d);
                }}
              />
            </View>
          ) : (
            <Text style={styles.muted}>Parking rules are checked for right now. Use “Arrive by” to plan a future trip.</Text>
          )}
        </Field>

        <Field label="Walk distance">
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderValue}>{maxWalkMinutes} min</Text>
          </View>
          <Slider
            minimumValue={WALK_MIN}
            maximumValue={WALK_MAX}
            step={1}
            value={maxWalkMinutes}
            onValueChange={setMaxWalkMinutes}
            minimumTrackTintColor="#0a7ea4"
            maximumTrackTintColor="#d4d7da"
            thumbTintColor="#0a7ea4"
            accessibilityLabel={`Maximum walk ${maxWalkMinutes} minutes`}
          />
          <View style={styles.sliderScale}>
            <Text style={styles.scaleEnd}>{WALK_MIN} min</Text>
            <Text style={styles.muted}>{walkHint}</Text>
            <Text style={styles.scaleEnd}>{WALK_MAX} min</Text>
          </View>
        </Field>

        {mode === 'transit' ? (
          <Field label="Buses">
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Include buses</Text>
                <Text style={styles.muted}>More stops to choose from, but routes are usually slower.</Text>
              </View>
              <Switch value={includeBus} onValueChange={setIncludeBus} />
            </View>
          </Field>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.buttonText}>{canSubmit ? 'Find free parking' : 'Choose a destination first'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  destWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eef6f9',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  pinIcon: { fontSize: 16 },
  pillLabel: { flex: 1, fontSize: 15, color: '#1c1c1e' },
  pillChange: { fontSize: 14, fontWeight: '600', color: '#0a7ea4' },

  hereButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#f3f5f7',
    borderWidth: 1,
    borderColor: '#e0e3e6',
  },
  hereButtonIcon: { fontSize: 14 },
  hereButtonText: { fontSize: 14, fontWeight: '600', color: '#0a7ea4' },
  locFailureHint: { marginTop: 8, fontSize: 12, color: '#a05050', lineHeight: 17 },

  scroll: { flex: 1, zIndex: 0 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 20 },

  field: { gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#8a8f94', textTransform: 'uppercase', letterSpacing: 0.5 },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f6f7f8',
    borderRadius: 12,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 6,
  },
  pickerLabel: { fontSize: 15, color: '#1c1c1e', flexShrink: 1 },

  sliderHeader: { alignItems: 'center' },
  sliderValue: { fontSize: 22, fontWeight: '700', color: '#0a7ea4' },
  sliderScale: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scaleEnd: { fontSize: 12, color: '#b0b4b8' },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },

  muted: { fontSize: 13, color: '#8a8f94', flexShrink: 1, textAlign: 'center' },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e6e8ea',
  },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#c2c7cb' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
