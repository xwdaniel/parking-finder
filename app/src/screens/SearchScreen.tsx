import { StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ParkStackParamList, SearchParams } from '../navigation/types';

type Props = NativeStackScreenProps<ParkStackParamList, 'Search'>;

// Placeholder. Step 7 builds this out: Google Places autocomplete, mode toggle,
// time toggle (Leave now / Arrive by), walk-distance slider, bus toggle.
export function SearchScreen({ navigation }: Props) {
  const demoSearch: SearchParams = {
    destinationLat: 51.5072,
    destinationLng: -0.1276, // Trafalgar Square — placeholder
    destinationLabel: 'Placeholder destination',
    mode: 'walk',
    timeMode: 'now',
    maxWalkMinutes: 10,
    includeBus: false,
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        <Text style={styles.heading}>Where are you going?</Text>
        <Text style={styles.muted}>
          Search a destination, pick &ldquo;Park near&rdquo; or &ldquo;Park + Tube&rdquo;, set a
          walk radius, and ParkFree finds free street parking. (Controls land in Step 7.)
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => navigation.navigate('MapResults', { search: demoSearch })}
        >
          <Text style={styles.buttonText}>See results (placeholder)</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '700' },
  muted: { fontSize: 15, color: '#555', lineHeight: 21 },
  button: {
    marginTop: 8,
    backgroundColor: '#0a7ea4',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
