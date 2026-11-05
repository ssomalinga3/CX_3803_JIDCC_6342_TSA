import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { TrailLegend } from '@/components/trail-legend';
import { trailPresentation } from '@/data/trail-presentation';
import { usePublicGis } from '@/hooks/use-public-gis';
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
  const dockBottom = insets.bottom + BottomTabInset + 8;
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const gis = usePublicGis(process.env.EXPO_PUBLIC_API_URL);
  const location = useMapLocation();
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [dockHeight, setDockHeight] = useState(160);
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  useEffect(() => {
    // A first launch without a connection must not leave an endless spinner.
    const timeout = setTimeout(
      () => setLoadState((state) => (state === 'loading' ? 'unavailable' : state)),
      20000,
    );
    return () => clearTimeout(timeout);
  }, [attempt]);

  const ready = loadState === 'ready';
  const snapshot = gis.snapshot;
  const trails = useMemo(
    () => (snapshot ? trailPresentation(snapshot.collection) : undefined),
    [snapshot],
  );
  const fittedSnapshot = useRef<typeof snapshot>(undefined);
  const bounds = snapshot?.bounds;
  useEffect(() => {
    if (ready && bounds && fittedSnapshot.current !== snapshot) {
      fittedSnapshot.current = snapshot;
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
  }, [ready, bounds, snapshot, dockBottom, dockHeight, insets.top, location.fix]);
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
        {trails && trails.collection.features.length > 0 && (
          <GeoJSONSource id="public-gis" data={trails.collection}>
            <Layer
              id="gis-boundary-fill"
              type="fill"
              filter={['==', ['geometry-type'], 'Polygon']}
              paint={{ 'fill-color': '#8754c8', 'fill-opacity': 0.12 }}
            />
            <Layer
              id="gis-boundary-outline"
              type="line"
              afterId="gis-boundary-fill"
              filter={['==', ['geometry-type'], 'Polygon']}
              paint={{ 'line-color': '#7442b5', 'line-width': 3, 'line-dasharray': [3, 2] }}
            />
            <Layer
              id="gis-trail-casing"
              type="line"
              afterId="gis-boundary-outline"
              filter={['==', ['geometry-type'], 'LineString']}
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
              id="gis-landmarks"
              type="circle"
              afterId="gis-trail-names"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{
                'circle-color': '#007aff',
                'circle-radius': 7,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2,
              }}
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
                {snapshot.isDemo ? 'Demo GIS' : 'Public GIS'} · {snapshot.layers.length} layers ·{' '}
                {snapshot.collection.features.length} features
              </Text>
              <Text style={styles.note}>Purple boundary · Blue landmarks</Text>
              {snapshot.collection.features.some(
                (feature) => feature.properties.name_assignment === 'approximate',
              ) && (
                <Text style={styles.warning}>
                  Approximate trail names · Partial network. Check park signs.
                </Text>
              )}
              {snapshot.isDemo && (
                <Text style={styles.warning}>Synthetic shapes — not for navigation.</Text>
              )}
              {trails && <TrailLegend entries={trails.legend} />}
            </>
          )}
        </View>
        <Text style={styles.note}>
          Location stays on this device. Offline map downloads are not available yet.
        </Text>
      </View>
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
  warning: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#934400' },
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
