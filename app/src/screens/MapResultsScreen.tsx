import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ParkStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ParkStackParamList, 'MapResults'>;

// Placeholder. Step 8 adds the Mapbox map + viewport-clipped GeoJSON; Step 9 adds
// the @gorhom/bottom-sheet ranked list (collapsed / mid / expanded).
export function MapResultsScreen({ route }: Props) {
  const { search } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map + Results</Text>
      <Text style={styles.muted}>Mode: {search.mode === 'walk' ? 'Park near' : 'Park + Tube'}</Text>
      <Text style={styles.muted}>Destination: {search.destinationLabel}</Text>
      <Text style={styles.muted}>
        Time: {search.timeMode === 'now' ? 'Leave now' : `Arrive by ${search.arrivalTime ?? '—'}`}
      </Text>
      <Text style={styles.muted}>Max walk: {search.maxWalkMinutes} min</Text>
      <Text style={[styles.muted, styles.note]}>Map + bottom sheet wired in Steps 8–9.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  muted: { fontSize: 15, color: '#555' },
  note: { marginTop: 16, fontStyle: 'italic', color: '#888' },
});
