import {
  Camera,
  GeoJSONSource,
  ImageSource,
  Layer,
  Map,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailLegend } from '@/components/trail-legend';
import { FeatureDetailSheet } from '@/components/feature-detail-sheet';
import { featureDetails, pressedFeatureId } from '@/data/feature-details';
import type { GisSnapshot } from '@/data/gis';
import { trailPresentation } from '@/data/trail-presentation';
import { terrainAssets, visibleTerrainKeys } from '@/data/terrain';
import { useMapGis } from '@/hooks/map-gis-context';
import { useMapLocation } from '@/hooks/use-map-location';

// Initial browsing viewport only; not a survey point, GPS fix, or preserve boundary.
const PRESERVE_CENTER: [number, number] = [-84.4792, 33.7176];
const INITIAL_ZOOM = 15;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
type LoadState = 'loading' | 'ready' | 'unavailable';

export default function PreserveMap() {
  const insets = useSafeAreaInsets();
  // Native tabs already account for their height in the screen safe area.
  const dockBottom = insets.bottom;
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const { gis, visibleSnapshot, hidden } = useMapGis();
  const location = useMapLocation();
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [dockHeight, setDockHeight] = useState(160);
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [selection, setSelection] = useState<{ snapshot: GisSnapshot; id: string }>();
  useFocusEffect(useCallback(() => () => setSelection(undefined), []));

  useEffect(() => {
    // A first launch without a connection must not leave an endless spinner.
    const timeout = setTimeout(
      () => setLoadState((state) => (state === 'loading' ? 'unavailable' : state)),
      20000,
    );
    return () => clearTimeout(timeout);
  }, [attempt]);

  const ready = loadState === 'ready';
  const snapshot = visibleSnapshot;
  const details =
    selection && selection.snapshot === snapshot
      ? featureDetails(selection.snapshot, selection.id)
      : undefined;
  const trails = useMemo(
    () => (snapshot ? trailPresentation(snapshot.collection) : undefined),
    [snapshot],
  );
  const fittedSnapshot = useRef<typeof snapshot>(undefined);
  const fittedDockHeight = useRef<number | undefined>(undefined);
  // Visibility changes must not refit the visitor's camera when the key shrinks.
  const originalSnapshot = gis.snapshot;
  const bounds = originalSnapshot?.bounds;
  const visibilityChanged = useRef(false);
  const fittedHidden = useRef(hidden);
  useEffect(() => {
    if (fittedHidden.current !== hidden) {
      fittedHidden.current = hidden;
      visibilityChanged.current = true;
    }
    if (fittedSnapshot.current !== originalSnapshot) visibilityChanged.current = false;
    if (
      ready &&
      bounds &&
      (fittedSnapshot.current !== originalSnapshot ||
        (!visibilityChanged.current && fittedDockHeight.current !== dockHeight))
    ) {
      fittedSnapshot.current = originalSnapshot;
      fittedDockHeight.current = dockHeight;
      if (location.fix) return;
      const [west, south, east, north] = bounds;
      if (west === east || south === north) {
        camera.current?.easeTo({
          center: [(west + east) / 2, (south + north) / 2],
          zoom: INITIAL_ZOOM,
          duration: 300,
        });
      } else {
        camera.current?.fitBounds(bounds, {
          padding: {
            top: insets.top + 110,
            bottom: dockBottom + dockHeight + 20,
            left: 24,
            right: 84,
          },
          duration: 300,
        });
      }
    }
  }, [ready, bounds, originalSnapshot, dockBottom, dockHeight, insets.top, location.fix, hidden]);
  const locationMessage = {
    off: 'Browse the map · Location off',
    requesting: 'Checking location permission…',
    searching: 'Finding your location…',
    ready: 'Your location is shown in blue',
    stale: 'Location is out of date. Waiting for a fresh GPS fix.',
    denied: 'Location permission denied. You can still browse the map.',
    blocked: 'Location access is off. Enable it in Settings to see your position.',
    'services-disabled': 'Device location services are off. You can still browse the map.',
    unavailable: 'Location unavailable. Check device location services and try again.',
  }[location.status];
  const locating = location.status === 'requesting' || location.status === 'searching';
  async function zoomBy(delta: number) {
    try {
      const zoom = await map.current?.getZoom();
      if (zoom !== undefined) {
        camera.current?.zoomTo(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta)), {
          duration: 200,
        });
      }
    } catch {
      setLoadState('unavailable');
    }
  }

  return (
    <View style={styles.container}>
      <Map
        key={attempt}
        ref={map}
        testID="preserve-map"
        style={styles.map}
        mapStyle={MAP_STYLE}
        attribution
        attributionPosition={{ bottom: dockBottom + dockHeight + 8, left: 12 }}
        compassPosition={{ top: insets.top + 108, right: 24 }}
        onDidFinishRenderingMapFully={() => setLoadState('ready')}
        onDidFailLoadingMap={() => setLoadState('unavailable')}
      >
        <Camera
          ref={camera}
          initialViewState={{ center: PRESERVE_CENTER, zoom: INITIAL_ZOOM }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        />
        {visibleTerrainKeys(snapshot).map((key) => (
          <ImageSource
            key={key}
            id={`terrain-${key}`}
            testID={`terrain-${key}`}
            url={
              key === 'supplied'
                ? require('../../assets/terrain/supplied-hillshade.png')
                : require('../../assets/terrain/usgs-hillshade.png')
            }
            coordinates={
              terrainAssets[key].coordinates as [
                [number, number],
                [number, number],
                [number, number],
                [number, number],
              ]
            }
          >
            <Layer
              id={`terrain-${key}-relief`}
              type="raster"
              beforeId="gis-elevation-bands"
              paint={{ 'raster-opacity': 0.35, 'raster-fade-duration': 0 }}
            />
          </ImageSource>
        ))}
        {trails && trails.collection.features.length > 0 && (
          <GeoJSONSource
            id="public-gis"
            testID="public-gis-source"
            data={trails.collection}
            onPress={(event) => {
              if (!ready || !snapshot) return;
              const id = pressedFeatureId(snapshot, event.nativeEvent.features);
              if (id) {
                event.stopPropagation();
                setSelection({ snapshot, id });
              }
            }}
          >
            <Layer
              id="gis-elevation-bands"
              type="fill"
              filter={['==', ['get', 'feature_kind'], 'elevation_band']}
              paint={{
                'fill-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'elevation_min_ft_us'],
                  800,
                  '#dbe7d0',
                  900,
                  '#bac797',
                  1040,
                  '#a88966',
                ],
                'fill-opacity': 0.12,
              }}
            />
            <Layer
              id="gis-elevation-lines"
              type="line"
              afterId="gis-elevation-bands"
              filter={['==', ['get', 'feature_kind'], 'elevation_band']}
              paint={{ 'line-color': '#7b705a', 'line-opacity': 0.38, 'line-width': 0.7 }}
            />
            <Layer
              id="gis-elevation-labels"
              type="symbol"
              afterId="gis-elevation-lines"
              minzoom={17}
              filter={['==', ['get', 'feature_kind'], 'elevation_band']}
              layout={{
                'text-field': [
                  'concat',
                  ['to-string', ['get', 'elevation_min_ft_us']],
                  '–',
                  ['to-string', ['get', 'elevation_max_ft_us']],
                  ' ftUS',
                ],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-allow-overlap': false,
              }}
              paint={{ 'text-color': '#605644', 'text-halo-color': '#fff', 'text-halo-width': 1 }}
            />
            <Layer
              id="gis-natural-areas"
              type="fill"
              afterId="gis-elevation-labels"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                ['==', ['get', 'feature_kind'], 'natural_area'],
              ]}
              paint={{ 'fill-color': '#65994c', 'fill-opacity': 0.16 }}
            />
            <Layer
              id="gis-water"
              type="fill"
              afterId="gis-natural-areas"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                ['==', ['get', 'feature_kind'], 'water'],
              ]}
              paint={{
                'fill-color': '#459fd1',
                'fill-outline-color': '#277bb2',
                'fill-opacity': 0.7,
              }}
            />
            <Layer
              id="gis-roads"
              type="fill"
              afterId="gis-water"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                ['==', ['get', 'feature_kind'], 'road'],
              ]}
              paint={{ 'fill-color': '#9b9b94', 'fill-opacity': 0.65 }}
            />
            <Layer
              id="gis-buildings"
              type="fill"
              afterId="gis-roads"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                ['==', ['get', 'feature_kind'], 'building'],
              ]}
              paint={{
                'fill-color': '#b08766',
                'fill-outline-color': '#6d503a',
                'fill-opacity': 0.75,
              }}
            />
            <Layer
              id="gis-boundary-fill"
              type="fill"
              afterId="gis-buildings"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                [
                  'any',
                  ['==', ['get', 'feature_kind'], 'boundary'],
                  ['!', ['has', 'feature_kind']],
                ],
              ]}
              paint={{ 'fill-color': '#8754c8', 'fill-opacity': 0.04 }}
            />
            <Layer
              id="gis-boundary-outline"
              type="line"
              afterId="gis-boundary-fill"
              filter={[
                'all',
                ['==', ['geometry-type'], 'Polygon'],
                [
                  'any',
                  ['==', ['get', 'feature_kind'], 'boundary'],
                  ['!', ['has', 'feature_kind']],
                ],
              ]}
              paint={{ 'line-color': '#7442b5', 'line-width': 2, 'line-dasharray': [3, 2] }}
            />
            <Layer
              id="gis-context-lines"
              type="line"
              afterId="gis-boundary-outline"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['in', ['get', 'feature_kind'], ['literal', ['water', 'road']]],
              ]}
              paint={{
                'line-color': ['match', ['get', 'feature_kind'], 'water', '#277bb2', '#9b9b94'],
                'line-width': 2,
              }}
            />
            <Layer
              id="gis-landmarks"
              type="circle"
              afterId="gis-context-lines"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{
                'circle-color': [
                  'match',
                  ['get', 'landmark_kind'],
                  'source_annotation',
                  '#60646c',
                  '#007aff',
                ],
                'circle-radius': 6,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2,
              }}
            />
            <Layer
              id="gis-trail-casing"
              type="line"
              afterId="gis-landmarks"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['any', ['==', ['get', 'feature_kind'], 'trail'], ['!', ['has', 'feature_kind']]],
              ]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ['get', '_display_trail_casing'], 'line-width': 7 }}
            />
            <Layer
              id="gis-trails"
              type="line"
              afterId="gis-trail-casing"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['any', ['==', ['get', 'feature_kind'], 'trail'], ['!', ['has', 'feature_kind']]],
                ['==', ['get', '_display_trail_dashed'], false],
              ]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ['get', '_display_trail_color'], 'line-width': 4 }}
            />
            <Layer
              id="gis-unnamed-connections"
              type="line"
              afterId="gis-trails"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['any', ['==', ['get', 'feature_kind'], 'trail'], ['!', ['has', 'feature_kind']]],
                ['==', ['get', '_display_trail_dashed'], true],
              ]}
              layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
              paint={{
                'line-color': ['get', '_display_trail_color'],
                'line-width': 4,
                'line-dasharray': [2, 2],
              }}
            />
            <Layer
              id="gis-trail-names"
              type="symbol"
              afterId="gis-unnamed-connections"
              minzoom={14}
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['==', ['get', 'feature_kind'], 'trail'],
                ['has', 'trail_id'],
                ['==', ['typeof', ['get', 'name']], 'string'],
                ['!=', ['get', 'name'], ''],
              ]}
              layout={{
                'symbol-placement': 'line-center',
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 13,
                'text-offset': [0, -0.8],
                'text-rotation-alignment': 'viewport',
                'text-allow-overlap': false,
              }}
              paint={{ 'text-color': '#242424', 'text-halo-color': '#fff', 'text-halo-width': 2 }}
            />
            <Layer
              id="gis-landmark-names"
              type="symbol"
              afterId="gis-trail-names"
              minzoom={16}
              filter={[
                'all',
                ['==', ['geometry-type'], 'Point'],
                ['==', ['typeof', ['get', 'name']], 'string'],
              ]}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 12,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-max-width': 12,
              }}
              paint={{ 'text-color': '#242424', 'text-halo-color': '#fff', 'text-halo-width': 2 }}
            />
          </GeoJSONSource>
        )}
        {location.fix && (
          <GeoJSONSource
            id="device-location"
            data={{
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [location.fix.coords.longitude, location.fix.coords.latitude],
              },
              properties: {},
            }}
          >
            <Layer
              id="device-location-dot"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': '#007aff',
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <View pointerEvents="none" style={[styles.tabBackdrop, { height: dockBottom }]} />

      <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Cascade Springs Preserve</Text>
          <Text style={styles.subtitle}>Explore trails and boundaries</Text>
        </View>
      </View>

      <View style={[styles.controls, { bottom: dockBottom + dockHeight + 20 }]}>
        <MapButton
          label="Recenter on my location"
          disabled={!ready || !location.fix}
          onPress={() => {
            if (!location.fix) return;
            camera.current?.easeTo({
              center: [location.fix.coords.longitude, location.fix.coords.latitude],
              zoom: INITIAL_ZOOM,
              padding: {
                top: insets.top + 110,
                bottom: dockBottom + dockHeight + 20,
                left: 24,
                right: 84,
              },
              bearing: 0,
              pitch: 0,
              duration: 300,
            });
          }}
        >
          ⌖
        </MapButton>
        <MapButton
          label="Return to preserve"
          disabled={!ready}
          onPress={() => {
            camera.current?.easeTo({
              center: PRESERVE_CENTER,
              zoom: INITIAL_ZOOM,
              bearing: 0,
              pitch: 0,
              duration: 300,
            });
          }}
        >
          ◎
        </MapButton>
        <MapButton label="Zoom in" disabled={!ready} onPress={() => void zoomBy(1)}>
          +
        </MapButton>
        <MapButton label="Zoom out" disabled={!ready} onPress={() => void zoomBy(-1)}>
          −
        </MapButton>
      </View>

      <View
        style={[styles.dock, { bottom: dockBottom }]}
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
      >
        {loadState === 'loading' && (
          <View style={styles.status}>
            <ActivityIndicator accessibilityLabel="Loading map" />
            <Text style={styles.subtitle}>Loading map…</Text>
          </View>
        )}
        {loadState === 'unavailable' && (
          <View accessibilityLiveRegion="polite" style={styles.status}>
            <Text style={styles.subtitle}>Map unavailable. Check your connection.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading map"
              onPress={() => {
                fittedSnapshot.current = undefined;
                setLoadState('loading');
                setAttempt((value) => value + 1);
              }}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {ready && <Text style={styles.subtitle}>Pan or pinch to explore</Text>}
        <View accessibilityLiveRegion="polite" style={styles.gisStatus}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose GIS layers"
            onPress={() => router.push('/layers')}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryText}>Choose GIS Layers</Text>
          </Pressable>
          <Text style={styles.note}>{locationMessage}</Text>
          {location.fix?.coords.accuracy != null && (
            <Text style={styles.note}>
              Reported accuracy: about {Math.ceil(location.fix.coords.accuracy)} m
            </Text>
          )}
          {location.status === 'blocked' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open location settings"
              style={styles.retry}
              onPress={() => {
                setSettingsFailed(false);
                void Linking.openSettings().catch(() => setSettingsFailed(true));
              }}
            >
              <Text style={styles.retryText}>Open Settings</Text>
            </Pressable>
          ) : location.status !== 'ready' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my location"
              accessibilityState={{ disabled: locating }}
              disabled={locating}
              style={[styles.retry, locating && styles.dimmed]}
              onPress={location.enable}
            >
              <Text style={styles.retryText}>
                {locating ? 'Finding location…' : 'Use my location'}
              </Text>
            </Pressable>
          ) : null}
          {location.status !== 'off' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Turn off map location"
              onPress={location.disable}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryText}>Turn off location</Text>
            </Pressable>
          )}
          {settingsFailed && (
            <Text style={styles.note}>Could not open Settings. Open device Settings manually.</Text>
          )}
        </View>
        <View accessibilityLiveRegion="polite" style={styles.gisStatus}>
          {gis.status === 'unconfigured' && (
            <Text style={styles.note}>GIS API not configured. Basemap only.</Text>
          )}
          {gis.status === 'loading' && <Text style={styles.note}>Loading GIS layers…</Text>}
          {gis.status === 'error' && (
            <View style={styles.status}>
              <Text style={styles.note}>GIS layers unavailable. Basemap browsing still works.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry GIS layers"
                onPress={gis.retry}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Retry layers</Text>
              </Pressable>
            </View>
          )}
          {gis.status === 'empty' && (
            <Text style={styles.note}>No public GIS features available.</Text>
          )}
          {snapshot && (
            <>
              <Text style={styles.gisTitle}>
                {snapshot.isDemo ? 'Demo GIS' : 'Public GIS'} · {snapshot.layers.length}{' '}
                {snapshot.layers.length === 1 ? 'layer' : 'layers'} ·{' '}
                {snapshot.collection.features.length}{' '}
                {snapshot.collection.features.length === 1 ? 'feature' : 'features'}
              </Text>
              <Text style={styles.note}>
                {[
                  snapshot.collection.features.some(
                    (f) =>
                      f.properties.feature_kind === 'boundary' ||
                      (!f.properties.feature_kind && f.geometry.type.includes('Polygon')),
                  )
                    ? 'Purple boundary'
                    : null,
                  snapshot.collection.features.some((f) => f.geometry.type.includes('Point'))
                    ? 'Blue landmarks / gray annotations'
                    : null,
                  snapshot.collection.features.some((f) => f.properties.feature_kind === 'water')
                    ? 'Blue water'
                    : null,
                  snapshot.collection.features.some(
                    (f) => f.properties.feature_kind === 'natural_area',
                  )
                    ? 'Green areas'
                    : null,
                  snapshot.collection.features.some((f) => f.properties.feature_kind === 'road')
                    ? 'Gray roads'
                    : null,
                  snapshot.collection.features.some((f) => f.properties.feature_kind === 'building')
                    ? 'Brown buildings'
                    : null,
                  snapshot.collection.features.some(
                    (f) => f.properties.feature_kind === 'elevation_band',
                  )
                    ? 'Elevation bands · 20 ftUS'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {snapshot.layers.length === 0 && originalSnapshot!.layers.length > 0 && (
                <Text style={styles.note}>
                  All GIS layers are hidden. Basemap browsing remains available.
                </Text>
              )}
              {trails && <TrailLegend entries={trails.legend} />}
            </>
          )}
        </View>
      </View>
      {details && <FeatureDetailSheet details={details} onClose={() => setSelection(undefined)} />}
    </View>
  );
}

function MapButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  map: { flex: 1 },
  overlay: { position: 'absolute', left: 16, right: 16, alignItems: 'flex-start' },
  header: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 6,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.1)',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 16, color: '#3a3a3c', flexShrink: 1 },
  controls: { position: 'absolute', right: 16, bottom: 188, gap: 8 },
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 1px 4px rgba(0,0,0,0.12)',
  },
  buttonText: { fontSize: 30, color: '#1c1c1e' },
  dimmed: { opacity: 0.5 },
  tabBackdrop: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
  },
  dock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 8,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  note: { fontSize: 13, lineHeight: 19, color: '#60646c' },
  gisStatus: { gap: 4 },
  gisTitle: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  retry: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: '#007aff',
    borderRadius: 12,
  },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryAction: { minHeight: 44, justifyContent: 'center' },
  secondaryText: { color: '#007aff', fontSize: 16 },
});
