import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

import { GOOGLE_PLACES_API_KEY, HAS_GOOGLE_PLACES } from '../lib/env';
import { searchPlacesApple, type PlaceSuggestion } from '../lib/geocode';

interface Props {
  onSelect: (place: PlaceSuggestion) => void;
  /** Re-mount key bump from the parent to reset the field (e.g. after "change destination"). */
  autoFocus?: boolean;
}

/**
 * Destination search field. Uses Google Places autocomplete when a key is configured
 * (brief §2/§4); otherwise falls back to Apple's on-device geocoder so the screen is
 * fully usable with zero setup. Either way, picking a result calls `onSelect`.
 */
export function DestinationInput({ onSelect, autoFocus = true }: Props) {
  return HAS_GOOGLE_PLACES ? (
    <GoogleDestinationInput onSelect={onSelect} autoFocus={autoFocus} />
  ) : (
    <AppleDestinationInput onSelect={onSelect} autoFocus={autoFocus} />
  );
}

// --- Google Places ---------------------------------------------------------------

function GoogleDestinationInput({ onSelect, autoFocus }: Props) {
  return (
    <View style={styles.googleWrap}>
      <GooglePlacesAutocomplete
        placeholder="Where are you going?"
        fetchDetails
        keyboardShouldPersistTaps="handled"
        enablePoweredByContainer={false}
        predefinedPlaces={[]}
        minLength={2}
        debounce={250}
        textInputProps={{ autoFocus, autoCorrect: false, returnKeyType: 'search' }}
        query={{ key: GOOGLE_PLACES_API_KEY ?? '', language: 'en', components: 'country:gb' }}
        onPress={(data, details) => {
          // Legacy Places API exposes coords at geometry.location; the "new" API at .location.
          const loc = details?.location ?? details?.geometry?.location;
          if (!loc) return;
          onSelect({
            id: data.place_id || `g:${loc.lat},${loc.lng}`,
            label: data.description || details?.formatted_address || 'Destination',
            latitude: loc.lat,
            longitude: loc.lng,
          });
        }}
        styles={{
          container: { flex: 0 },
          textInput: styles.textInput,
          listView: styles.listOverlay,
          row: styles.row,
          description: styles.rowText,
          separator: styles.separator,
        }}
      />
    </View>
  );
}

// --- Apple on-device geocoder (fallback) -----------------------------------------

function AppleDestinationInput({ onSelect, autoFocus }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, []);

  const onChangeText = (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const q = next.trim();
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      const found = await searchPlacesApple(q, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setLoading(false);
    }, 350);
  };

  return (
    <View style={styles.googleWrap}>
      <View style={styles.appleInputRow}>
        <TextInput
          style={[styles.textInput, styles.appleTextInput]}
          placeholder="Where are you going?"
          placeholderTextColor="#9aa0a6"
          value={text}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading ? <ActivityIndicator style={styles.appleSpinner} /> : null}
      </View>
      <Text style={styles.appleHint}>Using Apple Maps search — add a Google Places key for richer suggestions.</Text>
      {results.length > 0 ? (
        <View style={[styles.listOverlay, styles.appleList]}>
          {results.map((p) => (
            <Pressable key={p.id} style={styles.row} onPress={() => onSelect(p)}>
              <Text style={styles.rowText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  googleWrap: { zIndex: 10 },
  textInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4d7da',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#1c1c1e',
  },
  appleInputRow: { justifyContent: 'center' },
  appleTextInput: { paddingRight: 36 },
  appleSpinner: { position: 'absolute', right: 12 },
  appleHint: { marginTop: 6, fontSize: 12, color: '#8a8f94' },
  listOverlay: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e3e6',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: 'hidden',
    zIndex: 20,
  },
  appleList: { top: 78 }, // sits below the input + the "using Apple Maps search" hint line
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  rowText: { fontSize: 15, color: '#1c1c1e' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#e0e3e6' },
});
