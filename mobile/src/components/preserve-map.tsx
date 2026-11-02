import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useLocationPermission } from '@/hooks/use-location-permission';
import { currentCenter, useLiveLocation } from '@/hooks/use-live-location';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { usePublicGis } from '@/hooks/use-public-gis';
import LocationPermissionNotice from '@/components/location-permission-notice';

// Initial browsing viewport only; not a survey point, GPS fix, or preserve boundary.
const PRESERVE_CENTER: [number, number] = [-84.4792, 33.7176];
const INITIAL_ZOOM = 15;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
type LoadState = 'loading' | 'ready' | 'unavailable';

export default function PreserveMap() {
  const focused = useIsFocused();
  const access = useLocationPermission(focused);
  const gps = useLiveLocation(focused, access);
  const insets = useSafeAreaInsets();
  const fitted = useRef(false);
  const dockBottom = insets.bottom + BottomTabInset + 8;
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const gis = usePublicGis(process.env.EXPO_PUBLIC_API_URL);
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
  const bounds = snapshot?.bounds;
  useEffect(() => {
    if (ready && bounds && !fitted.current) {
      fitted.current = true;
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
  }, [ready, bounds, dockBottom, dockHeight, insets.top]);
  async function zoomBy(delta: number) {
    fitted.current = true;
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
        onRegionWillChange={(event) => {
          if (event.nativeEvent.userInteraction) fitted.current = true;
        }}
        onDidFinishRenderingMapFully={() => setLoadState('ready')}
        onDidFailLoadingMap={() => setLoadState('unavailable')}
      >
        <Camera
          ref={camera}
          initialViewState={{ center: PRESERVE_CENTER, zoom: INITIAL_ZOOM }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        />
        {snapshot && snapshot.collection.features.length > 0 && (
          <GeoJSONSource id="public-gis" data={snapshot.collection}>
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
              paint={{ 'line-color': '#fff', 'line-width': 7 }}
            />
            <Layer
              id="gis-trails"
              type="line"
              afterId="gis-trail-casing"
              filter={['==', ['geometry-type'], 'LineString']}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#c95700', 'line-width': 4 }}
            />
            <Layer
              id="gis-landmarks"
              type="circle"
              afterId="gis-trails"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{
                'circle-color': '#286653',
                'circle-radius': 7,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2,
              }}
            />
          </GeoJSONSource>
        )}
        {gps.fix && (
          <GeoJSONSource
            id="visitor-position"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: gps.fix.center },
            }}
          >
            <Layer
              id="visitor-position-dot"
              type="circle"
              paint={{
                'circle-color': '#007aff',
                'circle-radius': 9,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 4,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Cascade Springs Preserve</Text>
          <Text style={styles.subtitle}>
            {gps.status === 'live' ? 'Live device position · Blue dot' : 'Browse the map'}
          </Text>
        </View>
      </View>

      <View style={[styles.controls, { bottom: dockBottom + dockHeight + 20 }]}>
        <MapButton
          label="Return to preserve"
          disabled={!ready}
          onPress={() => {
            fitted.current = true;
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
              <Text style={styles.note}>Orange trails · Purple boundary · Green landmarks</Text>
              {snapshot.isDemo && (
                <Text style={styles.warning}>Synthetic shapes — not for navigation.</Text>
              )}
            </>
          )}
        </View>
        <LocationPermissionNotice access={access} />
        {access.status === 'granted' && (
          <View accessibilityLiveRegion="polite" style={styles.gisStatus}>
            <Text style={styles.note}>
              {gps.status === 'live'
                ? `${access.approximate === true ? 'Approximate location' : access.approximate === false ? 'Device location' : 'Location precision unknown'} · ${gps.fix?.accuracy == null ? 'Accuracy unavailable' : `Reported accuracy ±${Math.ceil(gps.fix.accuracy)} m`}. Not a trail-safety indicator.`
                : gps.status === 'stale'
                  ? 'GPS fix is stale. Waiting for a fresh position.'
                  : gps.status === 'unavailable'
                    ? 'GPS position unavailable. You can still browse the map.'
                    : 'Acquiring device position…'}
            </Text>
            <View style={styles.status}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready || !gps.fix }}
                disabled={!ready || !gps.fix}
                style={[styles.retry, (!ready || !gps.fix) && styles.dimmed]}
                onPress={() => {
                  const center = currentCenter(gps.fix);
                  if (!center) return;
                  fitted.current = true;
                  camera.current?.easeTo({
                    center,
                    zoom: INITIAL_ZOOM,
                    duration: 300,
                    padding: {
                      top: insets.top + 110,
                      bottom: dockBottom + dockHeight + 20,
                      left: 24,
                      right: 84,
                    },
                  });
                }}
              >
                <Text style={styles.retryText}>Recenter to current location</Text>
              </Pressable>
              {(gps.status === 'stale' || gps.status === 'unavailable') && (
                <Pressable accessibilityRole="button" style={styles.retry} onPress={gps.retry}>
                  <Text style={styles.retryText}>Retry GPS</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
        <Text style={styles.note}>
          Online map preview. Offline downloads are not available yet.
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
});
