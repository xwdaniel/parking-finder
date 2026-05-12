import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox, { Camera, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useZones } from '../hooks/useZones';
import { HAS_MAPBOX, MAPBOX_ACCESS_TOKEN } from '../lib/env';
import type { Bbox, ZoneFeature, ZoneProperties } from '../lib/api';
import type { ParkStackParamList, SearchParams } from '../navigation/types';

if (HAS_MAPBOX && MAPBOX_ACCESS_TOKEN) {
  try {
    Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
  } catch {
    // native module not present (e.g. Expo Go / un-prebuilt build) — the no-map fallback handles it
  }
}

type Props = NativeStackScreenProps<ParkStackParamList, 'MapResults'>;

const MAX_BBOX_SPAN = 0.45; // backend GET /zones rejects > 0.5° per side — stay safely under

// --- confidence → display tier (brief §6.5) --------------------------------------

type Tier = 'best' | 'good' | 'unknown' | 'low' | 'excluded';

function tierOf(p: ZoneProperties): Tier {
  if (!p.eligible) return 'excluded';
  if (!p.boroughHasAdapter) return 'low'; // 0.4 — no CPZ adapter for this borough
  if (p.zoneUnknown || p.confidence <= 0.6) return 'unknown'; // 0.6 — in a CPZ, hours unknown
  if (p.confidence >= 1.0) return 'best'; // 1.0 — authoritative API source (Camden)
  return 'good'; // 0.8 — static-JSON hit / outside the cpz_area
}

const TIER_COLOR: Record<Tier, string> = {
  best: '#1a9850',
  good: '#7cc36b',
  unknown: '#f0a020',
  low: '#9aa0a6',
  excluded: '#d97c7c',
};

const TIER_LABEL: Record<Tier, string> = {
  best: 'Free now',
  good: 'Free now',
  unknown: 'In a CPZ — verify signage',
  low: 'No zone data — check signs',
  excluded: 'Restricted right now',
};

function arrivalTimeOf(search: SearchParams): string | null {
  return search.timeMode === 'arrive_by' ? search.arrivalTime ?? null : null;
}

function whenLabel(search: SearchParams): string {
  const t = arrivalTimeOf(search);
  if (!t) return 'right now';
  return `by ${new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

/** A destination-centred box ~the size of the walk radius — the initial viewport / fallback bbox. */
function initialBbox(search: SearchParams): Bbox {
  const radiusM = search.maxWalkMinutes * 80; // 80 m/min (brief §5)
  const spanDeg = Math.min(MAX_BBOX_SPAN, Math.max(0.012, ((radiusM * 2) / 111_000) * 1.4));
  const half = spanDeg / 2;
  return [search.destinationLng - half, search.destinationLat - half, search.destinationLng + half, search.destinationLat + half];
}

// =================================================================================

export function MapResultsScreen({ route, navigation }: Props) {
  const { search } = route.params;

  useEffect(() => {
    navigation.setOptions({ title: search.destinationLabel });
  }, [navigation, search.destinationLabel]);

  return HAS_MAPBOX ? <MapResults search={search} /> : <NoMapResults search={search} />;
}

// --- with Mapbox -----------------------------------------------------------------

function MapResults({ search }: { search: SearchParams }) {
  const dest: [number, number] = [search.destinationLng, search.destinationLat];
  const initial = useMemo(() => initialBbox(search), [search]);
  const initialZoom = useMemo(() => Math.max(11, Math.min(16, Math.log2(280 / (initial[2] - initial[0])))), [initial]);

  const [bbox, setBbox] = useState<Bbox>(initial);
  const [tooWide, setTooWide] = useState(false);
  const mapRef = useRef<MapView>(null);

  const onMapIdle = async () => {
    try {
      const b = await mapRef.current?.getVisibleBounds(); // [ne, sw] as [lng, lat]
      if (!b) return;
      const [ne, sw] = b;
      const next: Bbox = [sw[0], sw[1], ne[0], ne[1]];
      const wide = next[2] - next[0] > MAX_BBOX_SPAN || next[3] - next[1] > MAX_BBOX_SPAN;
      setTooWide(wide);
      if (!wide) setBbox(next);
    } catch {
      /* transient — ignore */
    }
  };

  const { data, isFetching, isError, error } = useZones(bbox, arrivalTimeOf(search), !tooWide);
  const features = useMemo(() => data?.features ?? [], [data]);

  const shaped = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: features.map((f: ZoneFeature) => ({ ...f, properties: { ...f.properties, tier: tierOf(f.properties) } })),
    }),
    [features],
  );

  const eligibleCount = features.filter((f) => f.properties.eligible).length;
  const adapterlessBoroughs = useMemo(
    () => [...new Set(features.filter((f) => !f.properties.boroughHasAdapter).map((f) => f.properties.borough))],
    [features],
  );
  const presentTiers = useMemo(() => new Set(features.map((f) => tierOf(f.properties))), [features]);

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={styles.fill}
        styleURL={Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        onMapIdle={onMapIdle}
      >
        <Camera defaultSettings={{ centerCoordinate: dest, zoomLevel: initialZoom }} animationMode="none" />

        <ShapeSource id="zones" shape={shaped}>
          <LineLayer
            id="zones-line"
            style={{
              lineColor: [
                'match',
                ['get', 'tier'],
                'best',
                TIER_COLOR.best,
                'good',
                TIER_COLOR.good,
                'unknown',
                TIER_COLOR.unknown,
                'low',
                TIER_COLOR.low,
                'excluded',
                TIER_COLOR.excluded,
                '#888888',
              ],
              lineWidth: ['match', ['get', 'tier'], 'excluded', 2, 'low', 3, 4.5],
              lineOpacity: ['match', ['get', 'tier'], 'excluded', 0.45, 0.92],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        <MarkerView coordinate={dest} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.destPin}>
            <View style={styles.destPinInner} />
          </View>
        </MarkerView>
      </MapView>

      {/* Top: warning banner (when an adapter-less borough is in view) + a slim status strip */}
      <SafeAreaView edges={['top']} style={styles.topOverlay} pointerEvents="box-none">
        {adapterlessBoroughs.length > 0 ? (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              ⚠ Limited data in {adapterlessBoroughs.join(', ')} — no parking-zone rules available here. Check every sign.
            </Text>
          </View>
        ) : null}
        <View style={styles.statusStrip}>
          <Text style={styles.statusText} numberOfLines={1}>
            {tooWide
              ? 'Zoom in to see parking zones'
              : isError
                ? `Couldn’t load zones — ${(error as Error)?.message ?? 'try again'}`
                : data
                  ? `${eligibleCount} of ${features.length} streets in view are free ${whenLabel(search)}`
                  : 'Loading parking zones…'}
          </Text>
          {isFetching ? <ActivityIndicator size="small" /> : null}
        </View>
      </SafeAreaView>

      {/* Bottom-left legend (the @gorhom/bottom-sheet list replaces this in Step 9) */}
      {presentTiers.size > 0 ? (
        <SafeAreaView edges={['bottom', 'left']} style={styles.legendWrap} pointerEvents="none">
          <View style={styles.legend}>
            {(['best', 'good', 'unknown', 'low', 'excluded'] as Tier[])
              .filter((t) => presentTiers.has(t))
              // collapse the two "Free now" rows into one
              .filter((t, i, arr) => !(t === 'good' && arr.includes('best')))
              .map((t) => (
                <View key={t} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: TIER_COLOR[t] }]} />
                  <Text style={styles.legendText}>{TIER_LABEL[t]}</Text>
                </View>
              ))}
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

// --- without Mapbox (no token configured) ----------------------------------------

function NoMapResults({ search }: { search: SearchParams }) {
  const bbox = useMemo(() => initialBbox(search), [search]);
  const { data, isLoading, isError, error } = useZones(bbox, arrivalTimeOf(search));
  const features = data?.features ?? [];
  const eligible = features.filter((f) => f.properties.eligible);
  const adapterlessBoroughs = [...new Set(features.filter((f) => !f.properties.boroughHasAdapter).map((f) => f.properties.borough))];

  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <View style={styles.noMapBody}>
        <Text style={styles.noMapTitle}>{search.destinationLabel}</Text>
        <Text style={styles.noMapMeta}>
          {search.mode === 'walk' ? 'Park near' : 'Park + Tube'} · arrive {whenLabel(search)} · {search.maxWalkMinutes} min walk
        </Text>
        <Text style={styles.noMapHint}>Add a Mapbox token in app/.env (see app/.env.example) to show the map.</Text>

        {adapterlessBoroughs.length > 0 ? (
          <View style={[styles.warningBanner, styles.warningBannerInline]}>
            <Text style={styles.warningText}>
              ⚠ Limited data in {adapterlessBoroughs.join(', ')} — no parking-zone rules. Check every sign.
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.noMapState}>
            <ActivityIndicator />
            <Text style={styles.noMapMeta}>Loading zones near the destination…</Text>
          </View>
        ) : isError ? (
          <Text style={styles.noMapError}>Couldn’t load zones: {(error as Error)?.message ?? 'unknown error'}</Text>
        ) : (
          <>
            <Text style={styles.noMapCount}>
              {eligible.length} of {features.length} streets nearby are free {whenLabel(search)}
            </Text>
            <ScrollView style={styles.noMapList} contentContainerStyle={styles.noMapListContent}>
              {eligible.slice(0, 30).map((f) => {
                const t = tierOf(f.properties);
                return (
                  <View key={f.properties.id} style={styles.noMapItem}>
                    <View style={[styles.legendDot, { backgroundColor: TIER_COLOR[t] }]} />
                    <View style={styles.noMapItemText}>
                      <Text style={styles.noMapItemName}>{f.properties.streetName ?? '(unnamed street)'}</Text>
                      <Text style={styles.noMapItemSub}>
                        {TIER_LABEL[t]}
                        {f.properties.hours ? ` · CPZ ${f.properties.hours}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {eligible.length === 0 ? <Text style={styles.noMapMeta}>No free streets in this area at that time.</Text> : null}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#fff' },

  destPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0a7ea4',
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  destPinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  warningBanner: { backgroundColor: '#fbeaea', borderColor: '#e0b4b4', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  warningBannerInline: { marginTop: 16 },
  warningText: { color: '#9c2b2b', fontSize: 13, lineHeight: 18 },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  statusText: { flex: 1, fontSize: 13, color: '#333' },

  legendWrap: { position: 'absolute', bottom: 0, left: 0, padding: 12 },
  legend: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: 10, gap: 6, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: '#444' },

  noMapBody: { flex: 1, padding: 20, gap: 10 },
  noMapTitle: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  noMapMeta: { fontSize: 14, color: '#666' },
  noMapHint: { fontSize: 13, color: '#8a8f94', fontStyle: 'italic' },
  noMapState: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  noMapError: { fontSize: 14, color: '#9c2b2b', marginTop: 8 },
  noMapCount: { fontSize: 15, fontWeight: '600', color: '#1c1c1e', marginTop: 8 },
  noMapList: { flex: 1, marginTop: 4 },
  noMapListContent: { gap: 10, paddingBottom: 16 },
  noMapItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noMapItemText: { flex: 1 },
  noMapItemName: { fontSize: 15, color: '#1c1c1e' },
  noMapItemSub: { fontSize: 12, color: '#8a8f94' },
});
