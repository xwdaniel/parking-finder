import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Placeholder. Step 13 backs this with expo-sqlite: search history + parking
// outcomes, the post-park "How did it go?" prompt, and the verified_hours flow.
export function LogScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title}>Your parking log</Text>
        <Text style={styles.muted}>
          Every search and outcome gets recorded here — the validation instrument (brief §7, §11).
          Becomes &ldquo;places I&rsquo;ve parked free before&rdquo; over time. (Built in Step 13.)
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { fontSize: 15, color: '#555', lineHeight: 21 },
});
