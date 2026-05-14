import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import Mapbox, { Camera, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useTransitSearch } from '../hooks/useTransitSearch';
import { useWalkSearch } from '../hooks/useWalkSearch';
import { useZones } from '../hooks/useZones';
import { HAS_MAPBOX, MAPBOX_ACCESS_TOKEN } from '../lib/env';
import type { Bbox, DisruptionTier, JourneyLeg, LegMode, TransitResult, WalkResult, ZoneFeature, ZoneProperties } from '../lib/api';
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

/** 1/2/3 confidence dots (brief §6.5 / D13) — 0.6 and 0.4 both render as 1 dot, distinguished by colour + text. */
function dotsFor(p: ZoneProperties): number {
  if (p.confidence >= 1.0) return 3;
  if (p.confidence >= 0.8) return 2;
  return 1;
}

function formatWalk(min: number): string {
  if (min < 1) return '<1 min';
  return `${Math.round(min)} min`;
}

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

/** Open Google Maps with a driving directions URL; fall back to Apple Maps if not installed (D15). */
async function navigateTo(lat: number, lng: number): Promise<void> {
  const google = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
  const apple = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  try {
    const target = (await Linking.canOpenURL(google)) ? google : apple;
    await Linking.openURL(target);
  } catch {
    // Last-resort: try Apple Maps directly.
    await Linking.openURL(apple).catch(() => {
      /* nothing we can do */
    });
  }
}

// =================================================================================

export function MapResultsScreen({ route, navigation }: Props) {
  const { search } = route.params;

  useEffect(() => {
    navigation.setOptions({ title: search.destinationLabel });
  }, [navigation, search.destinationLabel]);

  if (!HAS_MAPBOX) return <NoMapResults search={search} />;
  return search.mode === 'transit' ? <TransitMapResults search={search} /> : <MapResults search={search} />;
}

// --- with Mapbox -----------------------------------------------------------------

const SNAP_POINTS: (string | number)[] = ['18%', '50%', '90%'];
const SNAP_COLLAPSED = 0;
const SNAP_MID = 1;
const SNAP_EXPANDED = 2;

function MapResults({ search }: { search: SearchParams }) {
  const dest: [number, number] = [search.destinationLng, search.destinationLat];
  const initial = useMemo(() => initialBbox(search), [search]);
  const initialZoom = useMemo(() => Math.max(11, Math.min(16, Math.log2(280 / (initial[2] - initial[0])))), [initial]);
  const arrivalT = arrivalTimeOf(search);

  // Map state — viewport bbox for /zones, "too wide" guard
  const [bbox, setBbox] = useState<Bbox>(initial);
  const [tooWide, setTooWide] = useState(false);
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);

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

  // Map background — the time-aware viewport zones (step 8)
  const { data: zonesData, isFetching: zonesFetching, isError: zonesError, error: zonesErrorObj } = useZones(bbox, arrivalT, !tooWide);
  const features = useMemo(() => zonesData?.features ?? [], [zonesData]);

  // Ranked top-10 candidates — the bottom-sheet list (step 9)
  const { data: walkData, isLoading: walkLoading, isError: walkError, error: walkErrorObj } = useWalkSearch(
    { lat: search.destinationLat, lng: search.destinationLng },
    search.maxWalkMinutes,
    arrivalT,
  );
  const results: WalkResult[] = walkData?.results ?? [];

  // Selection — the zone the user has picked, drives the highlight on the map and the expanded sheet
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => results.find((r) => r.zone.properties.id === selectedId) ?? null, [results, selectedId]);
  const sheetRef = useRef<BottomSheet>(null);

  // Map shapes — base layer + ranked overlay + selected highlight
  const baseShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: features.map((f: ZoneFeature) => ({ ...f, properties: { ...f.properties, tier: tierOf(f.properties) } })),
    }),
    [features],
  );
  const rankedShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: results.map((r) => ({ ...r.zone, properties: { ...r.zone.properties, tier: tierOf(r.zone.properties), rank: r.score } })),
    }),
    [results],
  );
  const selectedShape = useMemo(
    () =>
      selected
        ? { type: 'FeatureCollection' as const, features: [selected.zone] }
        : { type: 'FeatureCollection' as const, features: [] },
    [selected],
  );

  // Centre the camera on the selected zone's walk-point when one is picked
  const flyToWalkPoint = useCallback((walkPoint: { lat: number; lng: number }) => {
    cameraRef.current?.setCamera({
      centerCoordinate: [walkPoint.lng, walkPoint.lat],
      zoomLevel: 16,
      animationMode: 'flyTo',
      animationDuration: 600,
    });
  }, []);

  const pickZone = useCallback(
    (result: WalkResult) => {
      setSelectedId(result.zone.properties.id);
      flyToWalkPoint(result.walkPoint);
      sheetRef.current?.snapToIndex(SNAP_EXPANDED);
    },
    [flyToWalkPoint],
  );

  // Tapping a zone polyline on the map — match by feature.id to the ranked top-10
  const onZoneTap = useCallback(
    (e: { features: Array<{ properties?: { id?: string } | null }> }) => {
      const tappedId = e.features[0]?.properties?.id;
      if (!tappedId) return;
      const found = results.find((r) => r.zone.properties.id === tappedId);
      if (found) pickZone(found);
      // Tapping a zone that's not in the top-10 is intentionally a no-op — it's just the map context.
    },
    [results, pickZone],
  );

  // Reset selection when the result set changes (e.g. arrival time edited mid-screen via deep link)
  useEffect(() => {
    if (selectedId && !results.some((r) => r.zone.properties.id === selectedId)) setSelectedId(null);
  }, [results, selectedId]);

  const eligibleCount = features.filter((f) => f.properties.eligible).length;
  const adapterlessBoroughs = useMemo(
    () => [...new Set(features.filter((f) => !f.properties.boroughHasAdapter).map((f) => f.properties.borough))],
    [features],
  );

  // What the sheet currently shows — driven by snap index + selection
  const [snapIndex, setSnapIndex] = useState<number>(SNAP_MID);
  const showDetail = snapIndex >= SNAP_EXPANDED && selected !== null;

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={styles.fill}
        styleURL={Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        onMapIdle={onMapIdle}
      >
        <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: dest, zoomLevel: initialZoom }} animationMode="none" />

        {/* Base layer — every viewport zone, time-aware colour. Thin lines. */}
        <ShapeSource id="zones" shape={baseShape}>
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
              lineWidth: ['match', ['get', 'tier'], 'excluded', 1.5, 'low', 2, 3],
              lineOpacity: ['match', ['get', 'tier'], 'excluded', 0.35, 0.55],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {/* Ranked overlay — the top-10 from /search/walk, drawn heavier so they pop. */}
        <ShapeSource id="ranked" shape={rankedShape} onPress={onZoneTap} hitbox={{ width: 18, height: 18 }}>
          <LineLayer
            id="ranked-line"
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
                '#666',
              ],
              lineWidth: 6,
              lineOpacity: 0.95,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {/* Selected highlight — a thick navy outline around the picked zone. */}
        <ShapeSource id="selected" shape={selectedShape}>
          <LineLayer
            id="selected-line"
            style={{
              lineColor: '#0a3a5c',
              lineWidth: 10,
              lineOpacity: 0.35,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {/* Walk-leg dashed line from the selected walk-point to the destination. */}
        {selected ? (
          <ShapeSource
            id="walk-leg"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [selected.walkPoint.lng, selected.walkPoint.lat],
                  dest,
                ],
              },
            }}
          >
            <LineLayer
              id="walk-leg-line"
              style={{ lineColor: '#0a7ea4', lineWidth: 3, lineDasharray: [2, 2], lineCap: 'round' }}
            />
          </ShapeSource>
        ) : null}

        {/* Walk-point marker for the selected zone */}
        {selected ? (
          <MarkerView coordinate={[selected.walkPoint.lng, selected.walkPoint.lat]} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.walkPin}>
              <View style={styles.walkPinInner} />
            </View>
          </MarkerView>
        ) : null}

        {/* Destination pin (always on top) */}
        <MarkerView coordinate={dest} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.destPin}>
            <View style={styles.destPinInner} />
          </View>
        </MarkerView>
      </MapView>

      {/* Top: warning banner + status strip */}
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
              : zonesError
                ? `Couldn’t load zones — ${(zonesErrorObj as Error)?.message ?? 'try again'}`
                : zonesData
                  ? `${eligibleCount} of ${features.length} streets in view are free ${whenLabel(search)}`
                  : 'Loading parking zones…'}
          </Text>
          {zonesFetching ? <ActivityIndicator size="small" /> : null}
        </View>
      </SafeAreaView>

      {/* Bottom sheet — collapsed (top-3 cards) / mid (full list) / expanded (selected detail) */}
      <BottomSheet
        ref={sheetRef}
        index={SNAP_MID}
        snapPoints={SNAP_POINTS}
        onChange={setSnapIndex}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        {showDetail ? (
          <DetailView
            result={selected}
            onBack={() => sheetRef.current?.snapToIndex(SNAP_MID)}
          />
        ) : snapIndex === SNAP_COLLAPSED ? (
          <CollapsedView
            results={results}
            loading={walkLoading}
            error={walkError ? (walkErrorObj as Error)?.message : null}
            onPick={pickZone}
            search={search}
          />
        ) : (
          <ListView
            results={results}
            loading={walkLoading}
            error={walkError ? (walkErrorObj as Error)?.message : null}
            onPick={pickZone}
            search={search}
          />
        )}
      </BottomSheet>
    </View>
  );
}

// --- sheet content -------------------------------------------------------------

function SheetHeader({ search, count, suffix }: { search: SearchParams; count: number; suffix?: string }) {
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle} numberOfLines={1}>
        {count > 0
          ? `${count} place${count === 1 ? '' : 's'} within ${search.maxWalkMinutes} min walk${suffix ? ` · ${suffix}` : ''}`
          : `No free parking within ${search.maxWalkMinutes} min walk ${whenLabel(search)}`}
      </Text>
    </View>
  );
}

function CollapsedView({
  results,
  loading,
  error,
  onPick,
  search,
}: {
  results: WalkResult[];
  loading: boolean;
  error: string | null;
  onPick: (r: WalkResult) => void;
  search: SearchParams;
}) {
  const top = results.slice(0, 3);
  return (
    <BottomSheetView style={styles.sheetContent}>
      <SheetHeader search={search} count={results.length} suffix={loading ? 'searching…' : undefined} />
      {error ? (
        <Text style={styles.sheetError}>Couldn’t rank parking: {error}</Text>
      ) : results.length === 0 && !loading ? (
        <EmptyState search={search} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsRow}>
          {top.map((r, i) => (
            <Pressable key={r.zone.properties.id} style={styles.card} onPress={() => onPick(r)} accessibilityRole="button">
              <View style={styles.cardHeader}>
                <Text style={styles.cardRank}>#{i + 1}</Text>
                <Dots n={dotsFor(r.zone.properties)} tier={tierOf(r.zone.properties)} />
              </View>
              <Text style={styles.cardName} numberOfLines={2}>
                {r.zone.properties.streetName ?? '(unnamed street)'}
              </Text>
              <Text style={styles.cardWalk}>{formatWalk(r.walkMinutes)} walk</Text>
              <Text style={styles.cardTier} numberOfLines={1}>
                {TIER_LABEL[tierOf(r.zone.properties)]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </BottomSheetView>
  );
}

function ListView({
  results,
  loading,
  error,
  onPick,
  search,
}: {
  results: WalkResult[];
  loading: boolean;
  error: string | null;
  onPick: (r: WalkResult) => void;
  search: SearchParams;
}) {
  return (
    <BottomSheetFlatList
      data={results}
      keyExtractor={(r) => r.zone.properties.id}
      ListHeaderComponent={<SheetHeader search={search} count={results.length} suffix={loading ? 'searching…' : undefined} />}
      ListEmptyComponent={
        error ? (
          <Text style={styles.sheetError}>Couldn’t rank parking: {error}</Text>
        ) : loading ? (
          <View style={styles.sheetLoading}>
            <ActivityIndicator />
            <Text style={styles.sheetMuted}>Ranking nearby streets…</Text>
          </View>
        ) : (
          <EmptyState search={search} />
        )
      }
      contentContainerStyle={styles.listContent}
      renderItem={({ item, index }) => (
        <Pressable style={styles.row} onPress={() => onPick(item)} accessibilityRole="button">
          <Text style={styles.rowRank}>{index + 1}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.zone.properties.streetName ?? '(unnamed street)'}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {TIER_LABEL[tierOf(item.zone.properties)]}
              {item.zone.properties.zoneUnknown ? ' · verify signage' : ''}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowWalk}>{formatWalk(item.walkMinutes)}</Text>
            <Dots n={dotsFor(item.zone.properties)} tier={tierOf(item.zone.properties)} />
          </View>
        </Pressable>
      )}
    />
  );
}

function DetailView({ result, onBack }: { result: WalkResult; onBack: () => void }) {
  const p = result.zone.properties;
  const t = tierOf(p);
  return (
    <BottomSheetView style={styles.sheetContent}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.detailBack}>‹ Back to list</Text>
        </Pressable>
        <Dots n={dotsFor(p)} tier={t} />
      </View>

      <Text style={styles.detailName} numberOfLines={2}>
        {p.streetName ?? '(unnamed street)'}
      </Text>
      <Text style={styles.detailMeta}>
        {formatWalk(result.walkMinutes)} walk · {p.borough.replace(/_/g, ' ')}
      </Text>

      <View style={[styles.detailBadge, { backgroundColor: TIER_COLOR[t], opacity: t === 'excluded' ? 0.6 : 1 }]}>
        <Text style={styles.detailBadgeText}>{TIER_LABEL[t]}</Text>
      </View>

      {p.zoneUnknown ? (
        <View style={styles.detailVerify}>
          <Text style={styles.detailVerifyText}>⚠ Hours not catalogued — verify with signage before leaving the car.</Text>
        </View>
      ) : null}

      {p.hours ? (
        <View style={styles.detailHours}>
          <Text style={styles.detailHoursLabel}>Controlled-parking hours</Text>
          <Text style={styles.detailHoursValue}>{p.hours}</Text>
          <Text style={styles.detailMuted}>Free outside these hours.</Text>
        </View>
      ) : null}

      {p.hoursSpread && p.hoursSpread.length > 0 ? (
        <View style={styles.detailHours}>
          <Text style={styles.detailHoursLabel}>Borough CPZ hours — actual zone unknown</Text>
          {p.hoursSpread.slice(0, 4).map((h) => (
            <Text key={h} style={styles.detailHoursValue}>
              • {h}
            </Text>
          ))}
        </View>
      ) : null}

      {p.activeCpz ? (
        <View style={styles.detailExcluded}>
          <Text style={styles.detailExcludedText}>
            Restricted now by {p.activeCpz.displayName ?? p.activeCpz.sourceZoneId} ({p.activeCpz.hours}).
          </Text>
        </View>
      ) : null}

      <Pressable
        style={styles.navButton}
        onPress={() => void navigateTo(result.walkPoint.lat, result.walkPoint.lng)}
        accessibilityRole="button"
      >
        <Text style={styles.navButtonText}>Navigate · drive here</Text>
      </Pressable>
      <Text style={styles.detailMuted}>Opens Google Maps (or Apple Maps if not installed). Walking leg from the spot is on you.</Text>
    </BottomSheetView>
  );
}

function EmptyState({ search }: { search: SearchParams }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No free parking within {search.maxWalkMinutes} min walk {whenLabel(search)}.</Text>
      <Text style={styles.emptyHint}>Try widening the walk slider or arriving outside CPZ hours.</Text>
    </View>
  );
}

function Dots({ n, tier }: { n: number; tier: Tier }) {
  const color = TIER_COLOR[tier];
  return (
    <View style={styles.dotsRow} accessibilityLabel={`${n} of 3 confidence`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, { backgroundColor: i < n ? color : '#dadde0' }]} />
      ))}
    </View>
  );
}

// =================================================================================
// Transit mode (brief §5.2, build-order step 10)
// =================================================================================

const TIER_BADGE: Record<'severe' | 'minor' | 'none', { color: string; bg: string; label: string }> = {
  severe: { color: '#fff', bg: '#c0392b', label: '⚠ Severe delays' },
  minor: { color: '#7a5d18', bg: '#fff5dd', label: 'Minor delays' },
  none: { color: '#1c1c1e', bg: '#eef6f9', label: 'Good service' },
};

// Official TfL line palette — used for line badges in the journey sub-view. Keys
// match `leg.lineId` from the TfL Journey response ('northern', 'central', …),
// fall through by leg.mode for non-tube transit, and finally to a neutral grey.
const TFL_LINE_COLOR: Record<string, { bg: string; fg: string }> = {
  bakerloo:               { bg: '#B36305', fg: '#fff' },
  central:                { bg: '#E32017', fg: '#fff' },
  circle:                 { bg: '#FFD300', fg: '#000' },
  district:               { bg: '#00782A', fg: '#fff' },
  'hammersmith-city':     { bg: '#F3A9BB', fg: '#000' },
  jubilee:                { bg: '#A0A5A9', fg: '#000' },
  metropolitan:           { bg: '#9B0056', fg: '#fff' },
  northern:               { bg: '#000000', fg: '#fff' },
  piccadilly:             { bg: '#003688', fg: '#fff' },
  victoria:               { bg: '#0098D4', fg: '#fff' },
  'waterloo-city':        { bg: '#95CDBA', fg: '#000' },
  elizabeth:              { bg: '#6950A1', fg: '#fff' }, // TfL `id` for the Elizabeth line is 'elizabeth'
  dlr:                    { bg: '#00A4A7', fg: '#fff' },
  // Overground operators (TfL split the network in 2024 — each gets its own id).
  liberty:                { bg: '#5D6061', fg: '#fff' },
  lioness:                { bg: '#FAA61A', fg: '#000' },
  mildmay:                { bg: '#0080A3', fg: '#fff' },
  suffragette:            { bg: '#76B82A', fg: '#000' },
  weaver:                 { bg: '#A45A2A', fg: '#fff' },
  windrush:               { bg: '#DC241F', fg: '#fff' },
  'london-overground':    { bg: '#EE7C0E', fg: '#fff' }, // pre-2024 / fallback
};

const MODE_FALLBACK_COLOR: Record<LegMode, { bg: string; fg: string }> = {
  walking:           { bg: '#dadde0', fg: '#1c1c1e' },
  tube:              { bg: '#8a8f94', fg: '#fff' },
  dlr:               { bg: '#00A4A7', fg: '#fff' },
  overground:        { bg: '#EE7C0E', fg: '#fff' },
  'elizabeth-line':  { bg: '#6950A1', fg: '#fff' },
  bus:               { bg: '#DC241F', fg: '#fff' },
  other:             { bg: '#8a8f94', fg: '#fff' },
};

function lineSwatch(leg: JourneyLeg): { bg: string; fg: string } {
  if (leg.lineId && TFL_LINE_COLOR[leg.lineId]) return TFL_LINE_COLOR[leg.lineId]!;
  return MODE_FALLBACK_COLOR[leg.mode];
}

const MODE_ICON: Record<LegMode, string> = {
  walking: '🚶',
  tube: '🚇',
  dlr: '🚈',
  overground: '🚆',
  'elizabeth-line': '🚄',
  bus: '🚌',
  other: '➡︎',
};

function formatMinutes(min: number): string {
  if (min < 1) return '<1 min';
  return `${Math.round(min)} min`;
}

function formatHHMM(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const DISRUPTION_BADGE: Record<'severe' | 'minor' | 'suspended', { bg: string; fg: string; label: string }> = {
  suspended: { bg: '#9c2b2b', fg: '#fff', label: 'Suspended' },
  severe: { bg: '#c0392b', fg: '#fff', label: 'Severe delays' },
  minor: { bg: '#fff5dd', fg: '#7a5d18', label: 'Minor delays' },
};

function TransitMapResults({ search }: { search: SearchParams }) {
  const dest: [number, number] = [search.destinationLng, search.destinationLat];
  const initial = useMemo(() => initialBbox(search), [search]);
  const initialZoom = useMemo(() => Math.max(11, Math.min(16, Math.log2(280 / (initial[2] - initial[0])))), [initial]);

  const [bbox, setBbox] = useState<Bbox>(initial);
  const [tooWide, setTooWide] = useState(false);
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);

  const onMapIdle = async () => {
    try {
      const b = await mapRef.current?.getVisibleBounds();
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

  const arrivalT = arrivalTimeOf(search);
  // Map background — same time-aware viewport zones as walk mode (step 8)
  const { data: zonesData, isFetching: zonesFetching, isError: zonesError, error: zonesErrorObj } = useZones(bbox, arrivalT, !tooWide);
  const features = useMemo(() => zonesData?.features ?? [], [zonesData]);

  // Transit-ranked top-10 — drives the sheet AND the highlighted overlay
  const { data: transitData, isLoading: transitLoading, isError: transitError, error: transitErrorObj } = useTransitSearch({
    destination: { lat: search.destinationLat, lng: search.destinationLng },
    maxWalkMinutes: search.maxWalkMinutes,
    timeMode: search.timeMode,
    t: arrivalT,
    includeBus: search.includeBus,
  });
  const results: TransitResult[] = transitData?.results ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => results.find((r) => r.zone.properties.id === selectedId) ?? null, [results, selectedId]);
  const sheetRef = useRef<BottomSheet>(null);

  const baseShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: features.map((f: ZoneFeature) => ({ ...f, properties: { ...f.properties, tier: tierOf(f.properties) } })),
    }),
    [features],
  );
  const rankedShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: results.map((r) => ({ ...r.zone, properties: { ...r.zone.properties, tier: tierOf(r.zone.properties) } })),
    }),
    [results],
  );
  const selectedShape = useMemo(
    () => (selected ? { type: 'FeatureCollection' as const, features: [selected.zone] } : { type: 'FeatureCollection' as const, features: [] }),
    [selected],
  );

  const flyTo = useCallback((lat: number, lng: number) => {
    cameraRef.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: 15,
      animationMode: 'flyTo',
      animationDuration: 600,
    });
  }, []);

  const pickZone = useCallback(
    (result: TransitResult) => {
      setSelectedId(result.zone.properties.id);
      flyTo(result.zonePoint.lat, result.zonePoint.lng);
      sheetRef.current?.snapToIndex(SNAP_EXPANDED);
    },
    [flyTo],
  );

  const onZoneTap = useCallback(
    (e: { features: Array<{ properties?: { id?: string } | null }> }) => {
      const tappedId = e.features[0]?.properties?.id;
      if (!tappedId) return;
      const found = results.find((r) => r.zone.properties.id === tappedId);
      if (found) pickZone(found);
    },
    [results, pickZone],
  );

  useEffect(() => {
    if (selectedId && !results.some((r) => r.zone.properties.id === selectedId)) setSelectedId(null);
  }, [results, selectedId]);

  const adapterlessBoroughs = useMemo(
    () => [...new Set(features.filter((f) => !f.properties.boroughHasAdapter).map((f) => f.properties.borough))],
    [features],
  );

  const [snapIndex, setSnapIndex] = useState<number>(SNAP_MID);
  const showDetail = snapIndex >= SNAP_EXPANDED && selected !== null;

  return (
    <View style={styles.fill}>
      <MapView ref={mapRef} style={styles.fill} styleURL={Mapbox.StyleURL.Light} scaleBarEnabled={false} onMapIdle={onMapIdle}>
        <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: dest, zoomLevel: initialZoom }} animationMode="none" />

        <ShapeSource id="zones" shape={baseShape}>
          <LineLayer
            id="zones-line"
            style={{
              lineColor: [
                'match',
                ['get', 'tier'],
                'best', TIER_COLOR.best,
                'good', TIER_COLOR.good,
                'unknown', TIER_COLOR.unknown,
                'low', TIER_COLOR.low,
                'excluded', TIER_COLOR.excluded,
                '#888888',
              ],
              lineWidth: ['match', ['get', 'tier'], 'excluded', 1.5, 'low', 2, 3],
              lineOpacity: ['match', ['get', 'tier'], 'excluded', 0.35, 0.55],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        <ShapeSource id="ranked" shape={rankedShape} onPress={onZoneTap} hitbox={{ width: 18, height: 18 }}>
          <LineLayer
            id="ranked-line"
            style={{
              lineColor: [
                'match',
                ['get', 'tier'],
                'best', TIER_COLOR.best,
                'good', TIER_COLOR.good,
                'unknown', TIER_COLOR.unknown,
                'low', TIER_COLOR.low,
                '#666',
              ],
              lineWidth: 6,
              lineOpacity: 0.95,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        <ShapeSource id="selected" shape={selectedShape}>
          <LineLayer id="selected-line" style={{ lineColor: '#0a3a5c', lineWidth: 10, lineOpacity: 0.35, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>

        {/* Walk-to-stop leg (dashed line from parking point to chosen TfL stop). */}
        {selected ? (
          <ShapeSource
            id="walk-to-stop"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [selected.zonePoint.lng, selected.zonePoint.lat],
                  [selected.stop.lng, selected.stop.lat],
                ],
              },
            }}
          >
            <LineLayer id="walk-to-stop-line" style={{ lineColor: '#0a7ea4', lineWidth: 3, lineDasharray: [2, 2], lineCap: 'round' }} />
          </ShapeSource>
        ) : null}

        {/* Parking-point marker for the selected zone */}
        {selected ? (
          <MarkerView coordinate={[selected.zonePoint.lng, selected.zonePoint.lat]} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.walkPin}>
              <View style={styles.walkPinInner} />
            </View>
          </MarkerView>
        ) : null}

        {/* TfL stop marker for the selected result */}
        {selected ? (
          <MarkerView coordinate={[selected.stop.lng, selected.stop.lat]} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.stopPin}>
              <Text style={styles.stopPinText}>T</Text>
            </View>
          </MarkerView>
        ) : null}

        <MarkerView coordinate={dest} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.destPin}>
            <View style={styles.destPinInner} />
          </View>
        </MarkerView>
      </MapView>

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
              : zonesError
                ? `Couldn’t load zones — ${(zonesErrorObj as Error)?.message ?? 'try again'}`
                : `Park + ${search.includeBus ? 'Tube/Bus' : 'Tube'} · ${whenLabel(search)}`}
          </Text>
          {zonesFetching ? <ActivityIndicator size="small" /> : null}
        </View>
      </SafeAreaView>

      <BottomSheet
        ref={sheetRef}
        index={SNAP_MID}
        snapPoints={SNAP_POINTS}
        onChange={setSnapIndex}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        {showDetail ? (
          <TransitDetailView result={selected} onBack={() => sheetRef.current?.snapToIndex(SNAP_MID)} />
        ) : snapIndex === SNAP_COLLAPSED ? (
          <TransitCollapsedView results={results} loading={transitLoading} error={transitError ? (transitErrorObj as Error)?.message : null} onPick={pickZone} search={search} />
        ) : (
          <TransitListView results={results} loading={transitLoading} error={transitError ? (transitErrorObj as Error)?.message : null} onPick={pickZone} search={search} />
        )}
      </BottomSheet>
    </View>
  );
}

function TransitSheetHeader({ search, count, loading }: { search: SearchParams; count: number; loading: boolean }) {
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle} numberOfLines={1}>
        {count > 0
          ? `${count} Park + ${search.includeBus ? 'Tube/Bus' : 'Tube'} option${count === 1 ? '' : 's'}${loading ? ' · planning…' : ''}`
          : loading
            ? 'Planning transit routes…'
            : `No transit routes ${whenLabel(search)}`}
      </Text>
    </View>
  );
}

function TransitCollapsedView({
  results,
  loading,
  error,
  onPick,
  search,
}: {
  results: TransitResult[];
  loading: boolean;
  error: string | null;
  onPick: (r: TransitResult) => void;
  search: SearchParams;
}) {
  const top = results.slice(0, 3);
  return (
    <BottomSheetView style={styles.sheetContent}>
      <TransitSheetHeader search={search} count={results.length} loading={loading} />
      {error ? (
        <TransitErrorState error={error} />
      ) : results.length === 0 && !loading ? (
        <TransitEmptyState search={search} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsRow}>
          {top.map((r, i) => (
            <Pressable key={r.zone.properties.id} style={styles.card} onPress={() => onPick(r)} accessibilityRole="button">
              <View style={styles.cardHeader}>
                <Text style={styles.cardRank}>#{i + 1}</Text>
                <Dots n={dotsFor(r.zone.properties)} tier={tierOf(r.zone.properties)} />
              </View>
              <Text style={styles.cardName} numberOfLines={2}>
                {r.zone.properties.streetName ?? '(unnamed street)'}
              </Text>
              <Text style={styles.cardWalk}>
                {formatMinutes(r.totalMinutes)} total · via {r.stop.name.replace(/ (Underground|DLR|Overground|Rail|Station)/gi, '').trim()}
              </Text>
              {r.disruption !== 'none' ? <Text style={styles.cardDisr}>{TIER_BADGE[r.disruption].label}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </BottomSheetView>
  );
}

function TransitListView({
  results,
  loading,
  error,
  onPick,
  search,
}: {
  results: TransitResult[];
  loading: boolean;
  error: string | null;
  onPick: (r: TransitResult) => void;
  search: SearchParams;
}) {
  return (
    <BottomSheetFlatList
      data={results}
      keyExtractor={(r) => r.zone.properties.id}
      ListHeaderComponent={<TransitSheetHeader search={search} count={results.length} loading={loading} />}
      ListEmptyComponent={
        error ? <TransitErrorState error={error} /> : loading ? (
          <View style={styles.sheetLoading}>
            <ActivityIndicator />
            <Text style={styles.sheetMuted}>Planning journeys — TfL can take a few seconds.</Text>
          </View>
        ) : (
          <TransitEmptyState search={search} />
        )
      }
      contentContainerStyle={styles.listContent}
      renderItem={({ item, index }) => (
        <Pressable style={styles.row} onPress={() => onPick(item)} accessibilityRole="button">
          <Text style={styles.rowRank}>{index + 1}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.zone.properties.streetName ?? '(unnamed street)'}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              via {item.stop.name.replace(/ (Underground|DLR|Overground|Rail|Station)/gi, '').trim()}
              {item.disruption !== 'none' ? ` · ${TIER_BADGE[item.disruption].label}` : ''}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowWalk}>{formatMinutes(item.totalMinutes)}</Text>
            <Dots n={dotsFor(item.zone.properties)} tier={tierOf(item.zone.properties)} />
          </View>
        </Pressable>
      )}
    />
  );
}

function TransitDetailView({ result, onBack }: { result: TransitResult; onBack: () => void }) {
  const p = result.zone.properties;
  const t = tierOf(p);
  return (
    <BottomSheetScrollView style={styles.fill} contentContainerStyle={styles.sheetContent}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.detailBack}>‹ Back to list</Text>
        </Pressable>
        <Dots n={dotsFor(p)} tier={t} />
      </View>

      <Text style={styles.detailName} numberOfLines={2}>{p.streetName ?? '(unnamed street)'}</Text>
      <Text style={styles.detailMeta}>
        {formatMinutes(result.totalMinutes)} total · via {result.stop.name}
      </Text>

      <View style={[styles.detailBadge, { backgroundColor: TIER_COLOR[t] }]}>
        <Text style={styles.detailBadgeText}>{TIER_LABEL[t]}</Text>
      </View>

      {p.zoneUnknown ? (
        <View style={styles.detailVerify}>
          <Text style={styles.detailVerifyText}>⚠ Hours not catalogued — verify with signage before leaving the car.</Text>
        </View>
      ) : null}

      {p.hours ? (
        <View style={styles.detailHours}>
          <Text style={styles.detailHoursLabel}>Controlled-parking hours</Text>
          <Text style={styles.detailHoursValue}>{p.hours}</Text>
          <Text style={styles.detailMuted}>Free outside these hours.</Text>
        </View>
      ) : null}

      <JourneySummary result={result} />

      <Pressable
        style={styles.navButton}
        onPress={() => void navigateTo(result.zonePoint.lat, result.zonePoint.lng)}
        accessibilityRole="button"
      >
        <Text style={styles.navButtonText}>Navigate · drive here</Text>
      </Pressable>
      <Text style={styles.detailMuted}>Opens Google Maps (or Apple Maps if not installed). The walk legs at each end are on you.</Text>
    </BottomSheetScrollView>
  );
}

// --- Journey summary sub-view (brief §4 #3 / build-order step 11) -----------------

function JourneySummary({ result }: { result: TransitResult }) {
  const startHHMM = formatHHMM(result.startDateTime);
  const arrivalHHMM = formatHHMM(result.arrivalDateTime);
  return (
    <View style={styles.journey}>
      <View style={styles.journeyHeader}>
        <Text style={styles.journeyTitle}>Journey</Text>
        {result.disruption !== 'none' ? (
          <View style={[styles.journeyDisrupt, { backgroundColor: DISRUPTION_BADGE[result.disruption].bg }]}>
            <Text style={[styles.journeyDisruptText, { color: DISRUPTION_BADGE[result.disruption].fg }]}>
              {DISRUPTION_BADGE[result.disruption].label}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.journeyTimes}>
        <View style={styles.journeyTimeBlock}>
          <Text style={styles.journeyTimeLabel}>Park & start</Text>
          <Text style={styles.journeyTimeValue}>{startHHMM ?? '—'}</Text>
        </View>
        <View style={styles.journeyDashLine} />
        <View style={styles.journeyTimeBlock}>
          <Text style={styles.journeyTimeLabel}>Arrive</Text>
          <Text style={styles.journeyTimeValue}>{arrivalHHMM ?? '—'}</Text>
        </View>
        <View style={styles.journeyTimeBlock}>
          <Text style={styles.journeyTimeLabel}>Total</Text>
          <Text style={styles.journeyTimeValue}>{formatMinutes(result.totalMinutes)}</Text>
        </View>
      </View>

      {/* Drive leg — not part of TfL's leg list, but the user's mental model starts at the car */}
      <View style={styles.legRow}>
        <View style={styles.legLeft}>
          <Text style={styles.legIcon}>🚗</Text>
        </View>
        <View style={styles.legMain}>
          <Text style={styles.legPrimary}>Drive to {result.zone.properties.streetName ?? 'parking spot'}</Text>
          <Text style={styles.legSecondary}>Park, then walk to {result.stop.name}</Text>
        </View>
      </View>

      {result.legs.map((leg, i) => (
        <LegRow key={i} leg={leg} />
      ))}
    </View>
  );
}

function LegRow({ leg }: { leg: JourneyLeg }) {
  const showSwatch = leg.mode !== 'walking';
  const sw = lineSwatch(leg);
  return (
    <View style={styles.legRow}>
      <View style={styles.legLeft}>
        <Text style={styles.legIcon}>{MODE_ICON[leg.mode]}</Text>
        {showSwatch ? (
          <View style={[styles.lineBadge, { backgroundColor: sw.bg }]}>
            <Text style={[styles.lineBadgeText, { color: sw.fg }]} numberOfLines={1}>
              {leg.lineName ?? leg.mode}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.legMain}>
        <Text style={styles.legPrimary}>
          {leg.summary || (leg.mode === 'walking' ? `Walk ${leg.toName ? `to ${leg.toName}` : ''}` : `${leg.lineName ?? 'Transit'}`)}
        </Text>
        <Text style={styles.legSecondary}>
          {formatMinutes(leg.durationMinutes)}
          {leg.fromName && leg.toName ? ` · ${leg.fromName} → ${leg.toName}` : ''}
        </Text>
        {leg.disruption !== 'none' && leg.mode !== 'walking' ? (
          <View style={[styles.legDisrupt, { backgroundColor: DISRUPTION_BADGE[leg.disruption].bg }]}>
            <Text style={[styles.legDisruptText, { color: DISRUPTION_BADGE[leg.disruption].fg }]}>
              {DISRUPTION_BADGE[leg.disruption].label}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TransitEmptyState({ search }: { search: SearchParams }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No Park + Tube options {whenLabel(search)}.</Text>
      <Text style={styles.emptyHint}>
        Try widening the walk slider, switching to Park near, or arriving outside CPZ hours.
      </Text>
    </View>
  );
}

function TransitErrorState({ error }: { error: string }) {
  // The 503 (TFL_APP_KEY missing) case is by far the most likely failure on a dev build.
  const isKeyMissing = /TFL_APP_KEY/i.test(error);
  return (
    <View style={styles.empty}>
      <Text style={styles.sheetError}>
        {isKeyMissing
          ? 'Transit mode needs a TfL key. Add TFL_APP_KEY to backend/.env (see .env.example) and restart the server.'
          : `Couldn’t plan journeys: ${error}`}
      </Text>
    </View>
  );
}

// --- without Mapbox (no token configured) ----------------------------------------

function NoMapResults({ search }: { search: SearchParams }) {
  const arrivalT = arrivalTimeOf(search);
  const bbox = useMemo(() => initialBbox(search), [search]);
  const { data: zonesData } = useZones(bbox, arrivalT);
  const walkQ = useWalkSearch(
    { lat: search.destinationLat, lng: search.destinationLng },
    search.maxWalkMinutes,
    arrivalT,
    search.mode === 'walk',
  );
  const transitQ = useTransitSearch(
    {
      destination: { lat: search.destinationLat, lng: search.destinationLng },
      maxWalkMinutes: search.maxWalkMinutes,
      timeMode: search.timeMode,
      t: arrivalT,
      includeBus: search.includeBus,
    },
    search.mode === 'transit',
  );
  const features = zonesData?.features ?? [];
  const adapterlessBoroughs = [...new Set(features.filter((f) => !f.properties.boroughHasAdapter).map((f) => f.properties.borough))];

  const isTransit = search.mode === 'transit';
  const isLoading = isTransit ? transitQ.isLoading : walkQ.isLoading;
  const isError = isTransit ? transitQ.isError : walkQ.isError;
  const error = isTransit ? (transitQ.error as Error | undefined) : (walkQ.error as Error | undefined);
  const walkResults = walkQ.data?.results ?? [];
  const transitResults = transitQ.data?.results ?? [];

  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <View style={styles.noMapBody}>
        <Text style={styles.noMapTitle}>{search.destinationLabel}</Text>
        <Text style={styles.noMapMeta}>
          {isTransit ? `Park + ${search.includeBus ? 'Tube/Bus' : 'Tube'}` : 'Park near'} · arrive {whenLabel(search)} · {search.maxWalkMinutes} min walk
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
            <Text style={styles.noMapMeta}>{isTransit ? 'Planning transit routes…' : 'Ranking nearby streets…'}</Text>
          </View>
        ) : isError ? (
          <Text style={styles.noMapError}>
            {isTransit && /TFL_APP_KEY/i.test(error?.message ?? '')
              ? 'Transit mode needs a TfL key. Add TFL_APP_KEY to backend/.env (see .env.example) and restart the server.'
              : `Couldn’t ${isTransit ? 'plan journeys' : 'rank parking'}: ${error?.message ?? 'unknown error'}`}
          </Text>
        ) : isTransit ? (
          transitResults.length === 0 ? (
            <View style={styles.noMapState}>
              <Text style={styles.noMapMeta}>No Park + Tube options {whenLabel(search)}.</Text>
              <Text style={styles.noMapHint}>Try widening the walk slider or arriving outside CPZ hours.</Text>
            </View>
          ) : (
            <ScrollView style={styles.noMapList} contentContainerStyle={styles.noMapListContent}>
              {transitResults.map((r, i) => {
                const p = r.zone.properties;
                const t = tierOf(p);
                return (
                  <Pressable
                    key={p.id}
                    style={styles.noMapItem}
                    onPress={() => void navigateTo(r.zonePoint.lat, r.zonePoint.lng)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.noMapRank}>{i + 1}</Text>
                    <View style={[styles.legendDot, { backgroundColor: TIER_COLOR[t] }]} />
                    <View style={styles.noMapItemText}>
                      <Text style={styles.noMapItemName}>{p.streetName ?? '(unnamed street)'}</Text>
                      <Text style={styles.noMapItemSub}>
                        {formatMinutes(r.totalMinutes)} total · via {r.stop.name}
                        {r.disruption !== 'none' ? ` · ${TIER_BADGE[r.disruption].label}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )
        ) : walkResults.length === 0 ? (
          <View style={styles.noMapState}>
            <Text style={styles.noMapMeta}>No free parking within {search.maxWalkMinutes} min walk {whenLabel(search)}.</Text>
            <Text style={styles.noMapHint}>Try widening the walk slider.</Text>
          </View>
        ) : (
          <ScrollView style={styles.noMapList} contentContainerStyle={styles.noMapListContent}>
            {walkResults.map((r, i) => {
              const p = r.zone.properties;
              const t = tierOf(p);
              return (
                <Pressable
                  key={p.id}
                  style={styles.noMapItem}
                  onPress={() => void navigateTo(r.walkPoint.lat, r.walkPoint.lng)}
                  accessibilityRole="button"
                >
                  <Text style={styles.noMapRank}>{i + 1}</Text>
                  <View style={[styles.legendDot, { backgroundColor: TIER_COLOR[t] }]} />
                  <View style={styles.noMapItemText}>
                    <Text style={styles.noMapItemName}>{p.streetName ?? '(unnamed street)'}</Text>
                    <Text style={styles.noMapItemSub}>
                      {formatWalk(r.walkMinutes)} walk · {TIER_LABEL[t]}
                      {p.zoneUnknown ? ' · verify signage' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
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

  walkPin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#0a3a5c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkPinInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0a3a5c' },

  stopPin: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  stopPinText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  cardDisr: { fontSize: 12, fontWeight: '600', color: '#c0392b' },
  disruptBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  disruptBadgeText: { fontSize: 12, fontWeight: '700' },
  legLine: { fontSize: 13, color: '#1c1c1e' },

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

  sheetBg: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetHandle: { backgroundColor: '#c2c7cb', width: 36 },
  sheetContent: { flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20, gap: 10 },
  sheetHeader: { paddingHorizontal: 0, paddingVertical: 6 },
  sheetTitle: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  sheetMuted: { fontSize: 13, color: '#8a8f94' },
  sheetError: { fontSize: 13, color: '#9c2b2b', paddingHorizontal: 4 },
  sheetLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },

  cardsRow: { gap: 10, paddingVertical: 6, paddingRight: 6 },
  card: {
    width: 200,
    backgroundColor: '#f6f7f8',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardRank: { fontSize: 12, fontWeight: '700', color: '#8a8f94' },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  cardWalk: { fontSize: 13, color: '#1c1c1e' },
  cardTier: { fontSize: 12, color: '#666' },

  listContent: { paddingBottom: 30, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  rowRank: { width: 20, fontSize: 13, fontWeight: '700', color: '#8a8f94', textAlign: 'right' },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, color: '#1c1c1e' },
  rowSub: { fontSize: 12, color: '#8a8f94' },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowWalk: { fontSize: 13, fontWeight: '600', color: '#1c1c1e' },

  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },

  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailBack: { color: '#0a7ea4', fontSize: 14, fontWeight: '600' },
  detailName: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  detailMeta: { fontSize: 14, color: '#666' },
  detailBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  detailVerify: { backgroundColor: '#fff5dd', borderColor: '#e8c97a', borderWidth: StyleSheet.hairlineWidth, padding: 10, borderRadius: 10 },
  detailVerifyText: { color: '#7a5d18', fontSize: 13 },
  detailHours: { gap: 2, backgroundColor: '#f6f7f8', padding: 10, borderRadius: 10 },
  detailHoursLabel: { fontSize: 12, fontWeight: '700', color: '#8a8f94', textTransform: 'uppercase', letterSpacing: 0.4 },
  detailHoursValue: { fontSize: 14, color: '#1c1c1e' },
  detailMuted: { fontSize: 12, color: '#8a8f94' },
  detailExcluded: { backgroundColor: '#fbeaea', padding: 10, borderRadius: 10 },
  detailExcludedText: { color: '#9c2b2b', fontSize: 13 },
  navButton: { backgroundColor: '#0a7ea4', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  navButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  empty: { paddingVertical: 16, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#1c1c1e' },
  emptyHint: { fontSize: 13, color: '#666' },

  legendDot: { width: 12, height: 12, borderRadius: 6 },

  noMapBody: { flex: 1, padding: 20, gap: 10 },
  noMapTitle: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  noMapMeta: { fontSize: 14, color: '#666' },
  noMapHint: { fontSize: 13, color: '#8a8f94', fontStyle: 'italic' },
  noMapState: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  noMapError: { fontSize: 14, color: '#9c2b2b', marginTop: 8 },
  noMapList: { flex: 1, marginTop: 4 },
  noMapListContent: { gap: 10, paddingBottom: 16 },
  noMapItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noMapRank: { width: 18, fontSize: 13, fontWeight: '700', color: '#8a8f94', textAlign: 'right' },
  noMapItemText: { flex: 1 },
  noMapItemName: { fontSize: 15, color: '#1c1c1e' },
  noMapItemSub: { fontSize: 12, color: '#8a8f94' },

  // Journey sub-view (build-order step 11, brief §4 #3)
  journey: { backgroundColor: '#f6f7f8', borderRadius: 12, padding: 12, gap: 12 },
  journeyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  journeyTitle: { fontSize: 12, fontWeight: '700', color: '#8a8f94', textTransform: 'uppercase', letterSpacing: 0.4 },
  journeyDisrupt: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  journeyDisruptText: { fontSize: 11, fontWeight: '700' },
  journeyTimes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  journeyTimeBlock: { gap: 1 },
  journeyTimeLabel: { fontSize: 11, color: '#8a8f94', textTransform: 'uppercase', letterSpacing: 0.4 },
  journeyTimeValue: { fontSize: 17, fontWeight: '700', color: '#1c1c1e' },
  journeyDashLine: { flex: 1, height: 1, borderStyle: 'dashed', borderTopWidth: 1, borderColor: '#c2c7cb', marginHorizontal: 2, marginTop: 14 },

  legRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  legLeft: { width: 72, alignItems: 'flex-start', gap: 4 },
  legIcon: { fontSize: 20 },
  lineBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, alignSelf: 'flex-start', maxWidth: 70 },
  lineBadgeText: { fontSize: 11, fontWeight: '700' },
  legMain: { flex: 1, gap: 2 },
  legPrimary: { fontSize: 14, fontWeight: '600', color: '#1c1c1e' },
  legSecondary: { fontSize: 12, color: '#666' },
  legDisrupt: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 4 },
  legDisruptText: { fontSize: 11, fontWeight: '700' },
});
