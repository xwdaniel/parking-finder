import { useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOutcomes, useSearches } from '../hooks/useOutcomes';
import type { OutcomeKind, OutcomeRow, SearchRow } from '../lib/log/types';

// Brief §7 / §11: the personal log is the validation instrument. This screen surfaces
// the two tables together so the user can see "every search and outcome must be recorded".

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  parked_ok: 'Parked OK',
  ticketed: 'Ticketed',
  sign_said_permit: 'Sign said permit',
  unsafe: 'Felt unsafe',
  no_space: 'No space',
  verified_hours: 'Hours verified',
};

export function LogScreen() {
  const { data: searches, isLoading: searchesLoading } = useSearches(100);
  const { data: outcomes, isLoading: outcomesLoading } = useOutcomes();

  const summary = useMemo(() => {
    const totalSearches = searches?.length ?? 0;
    const totalPicked = (searches ?? []).filter((s) => s.pickedZoneId).length;
    let parkedOk = 0;
    let ticketed = 0;
    let hoursVerified = 0;
    for (const o of outcomes?.values() ?? []) {
      if (o.lastOutcome === 'parked_ok') parkedOk += 1;
      if (o.lastOutcome === 'ticketed') ticketed += 1;
      if (o.lastOutcome === 'verified_hours') hoursVerified += 1;
    }
    return { totalSearches, totalPicked, parkedOk, ticketed, hoursVerified };
  }, [searches, outcomes]);

  const loading = searchesLoading || outcomesLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your parking log</Text>
        <Text style={styles.muted}>Every search and outcome — locally stored, never synced (brief §7).</Text>
      </View>

      <View style={styles.summary}>
        <Stat label="Searches" value={summary.totalSearches} />
        <Stat label="Navigated" value={summary.totalPicked} />
        <Stat label="Parked OK" value={summary.parkedOk} tone={summary.parkedOk > 0 ? 'positive' : 'neutral'} />
        <Stat label="Tickets" value={summary.ticketed} tone={summary.ticketed > 0 ? 'negative' : 'neutral'} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (searches?.length ?? 0) === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No searches yet.</Text>
          <Text style={styles.emptyHint}>Find a free spot and the log fills up from here.</Text>
        </View>
      ) : (
        <FlatList
          data={searches}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <Row search={item} outcomes={outcomes ?? new Map()} />}
        />
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'positive' | 'negative' | 'neutral' }) {
  return (
    <View style={[styles.stat, tone === 'positive' && styles.statPositive, tone === 'negative' && styles.statNegative]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ search, outcomes }: { search: SearchRow; outcomes: Map<string, OutcomeRow> }) {
  const outcome = search.pickedZoneId ? outcomes.get(search.pickedZoneId) ?? null : null;
  const when = new Date(search.searchedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const modeLabel = search.mode === 'transit' ? 'Park + Tube' : 'Park near';
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {search.destinationLabel ?? 'Destination'}
        </Text>
        <Text style={styles.rowMeta}>
          {modeLabel} · {when}
        </Text>
        {outcome ? (
          <Text style={[styles.rowOutcome, outcome.lastOutcome === 'ticketed' && styles.rowOutcomeBad, outcome.lastOutcome === 'parked_ok' && styles.rowOutcomeGood]}>
            {outcome.lastOutcome ? OUTCOME_LABEL[outcome.lastOutcome] : 'No outcome'}
            {outcome.hoursObserved ? ` · ${outcome.hoursObserved}` : ''}
          </Text>
        ) : search.pickedZoneId ? (
          <Text style={styles.rowOutcomePending}>Navigated — outcome not recorded yet</Text>
        ) : (
          <Text style={styles.rowOutcomePending}>Searched — didn’t pick a spot</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 4 },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { fontSize: 13, color: '#666' },
  summary: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  stat: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center', gap: 2 },
  statPositive: { backgroundColor: '#e9f6e9' },
  statNegative: { backgroundColor: '#fbe9e9' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  statLabel: { fontSize: 11, color: '#555', textTransform: 'uppercase' },
  loading: { padding: 40, alignItems: 'center' },
  empty: { padding: 24, gap: 8, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  emptyHint: { fontSize: 14, color: '#777', textAlign: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  row: { padding: 14, borderRadius: 10, backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#eaeaea' },
  rowMain: { gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  rowMeta: { fontSize: 12, color: '#666' },
  rowOutcome: { marginTop: 4, fontSize: 13, color: '#333' },
  rowOutcomeGood: { color: '#1a7a1a', fontWeight: '600' },
  rowOutcomeBad: { color: '#9c2b2b', fontWeight: '600' },
  rowOutcomePending: { marginTop: 4, fontSize: 12, color: '#999', fontStyle: 'italic' },
});
