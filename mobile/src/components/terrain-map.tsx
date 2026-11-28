import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { LocationObject } from 'expo-location';
import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import {
  parseTerrainMessage,
  type terrainTrails,
  type TerrainViewState,
  TERRAIN_STARTUP_TIMEOUT,
} from '@/data/terrain-3d';
import { terrainDocument } from '@/data/terrain-3d-html';
import type { Basemap } from '@/data/basemaps';

export type TerrainHandle = Pick<CameraRef, 'easeTo' | 'zoomTo'> &
  Pick<MapRef, 'getZoom'> & { tilt: () => void };
export type TerrainStatus = 'loading' | 'ready' | 'unavailable';
type Props = {
  ref?: Ref<TerrainHandle>;
  trails: ReturnType<typeof terrainTrails>;
  basemap: Basemap;
  fix?: LocationObject;
  view: TerrainViewState;
  onViewChange: (view: TerrainViewState) => void;
  onStatus: (status: TerrainStatus) => void;
  onGesture: () => void;
  onReturnTo2d: () => void;
  onRetryTrails: () => void;
};

export function TerrainMap(props: Props) {
  const [lifecycle, setLifecycle] = useState({ active: false, generation: 0 });
  useFocusEffect(
    useCallback(() => {
      const activate = (active: boolean) =>
        setLifecycle((previous) => ({
          active,
          generation: previous.generation + (active ? 1 : 0),
        }));
      activate(AppState.currentState === 'active');
      const subscription = AppState.addEventListener('change', (state) =>
        activate(state === 'active'),
      );
      return () => {
        subscription.remove();
        activate(false);
      };
    }, []),
  );
  return (
    // Retain a native parent while the renderer attaches/releases on focus.
    <View style={styles.map} collapsable={false}>
      {lifecycle.active && (
        <TerrainRenderer
          key={`${props.trails.version}:${props.basemap.id}:${lifecycle.generation}`}
          {...props}
        />
      )}
    </View>
  );
}

function TerrainRenderer({
  ref,
  trails,
  basemap,
  fix,
  view,
  onViewChange,
  onStatus,
  onGesture,
  onReturnTo2d,
  onRetryTrails,
}: Props) {
  const webview = useRef<WebView>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [tileStatus, setTileStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const runtimeId = useId();
  const session = `${runtimeId}-${attempt}`;
  const [initialView] = useState(view);
  const latestViewRef = useRef(view);
  const [collection] = useState(trails.collection);
  const source = useMemo(
    () => ({
      html: terrainDocument(
        collection,
        session,
        initialView,
        basemap.id,
        Platform.OS === 'android',
      ),
      baseUrl: 'https://terrain.cascade.invalid/',
    }),
    [collection, session, initialView, basemap.id],
  );
  const hasTrails = trails.collection.features.length > 0;
  const inject = useCallback(
    (method: 'camera' | 'position' | 'tilt' | 'retryTiles', value?: unknown) => {
      const json = JSON.stringify(value ?? null).replace(/</g, '\\u003c');
      webview.current?.injectJavaScript(`window.cascade3d?.${method}(${json});true;`);
    },
    [],
  );
  useImperativeHandle(
    ref,
    () => ({
      easeTo: (options) =>
        inject('camera', { ...options, pitch: options.pitch === 0 ? 60 : options.pitch }),
      zoomTo: (zoom, options) => inject('camera', { ...options, zoom }),
      getZoom: async () => latestViewRef.current.zoom,
      tilt: () => inject('tilt'),
    }),
    [inject],
  );
  useEffect(() => {
    onStatus(
      status === 'ready'
        ? 'ready'
        : ['error', 'unsupported'].includes(status) || !hasTrails
          ? 'unavailable'
          : 'loading',
    );
  }, [onStatus, status, hasTrails]);
  useEffect(() => {
    if (status !== 'ready') return;
    inject('position', fix ? [fix.coords.longitude, fix.coords.latitude] : null);
  }, [fix, status, inject]);
  useEffect(() => {
    if (!hasTrails || status !== 'loading') return;
    const timeout = setTimeout(() => setStatus('error'), TERRAIN_STARTUP_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [hasTrails, status, attempt]);
  useEffect(() => {
    const instance = webview.current;
    return () => {
      instance?.injectJavaScript('window.cascade3d?.dispose();true;');
      onStatus('loading');
    };
  }, [onStatus]);

  return (
    <View style={styles.map} collapsable={false}>
      {hasTrails && (status === 'loading' || status === 'ready') && (
        <WebView
          ref={webview}
          key={attempt}
          testID="terrain-webview"
          source={source}
          style={styles.map}
          originWhitelist={['about:*', 'https://terrain.cascade.invalid']}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled={false}
          geolocationEnabled={false}
          cacheEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          mixedContentMode="never"
          onShouldStartLoadWithRequest={(request) =>
            request.url === 'about:blank' || request.url === 'https://terrain.cascade.invalid/'
          }
          onMessage={(event) => {
            const message = parseTerrainMessage(event.nativeEvent.data, session);
            if (message?.type === 'ready') setStatus('ready');
            else if (message?.type === 'error')
              setStatus(message.code === 'unsupported' ? 'unsupported' : 'error');
            else if (message?.type === 'gesture') onGesture();
            else if (message?.type === 'tiles') setTileStatus(message.status);
            else if (message?.type === 'camera') {
              latestViewRef.current = message.view;
              onViewChange(message.view);
            }
          }}
          onError={() => setStatus('error')}
          onHttpError={() => setStatus('error')}
          onContentProcessDidTerminate={() => setStatus('error')}
          onRenderProcessGone={() => setStatus('error')}
        />
      )}
      {status === 'ready' && tileStatus !== 'ready' && (
        <View style={styles.tileNotice} accessibilityLiveRegion="polite">
          <Text style={styles.text}>
            {tileStatus === 'loading'
              ? 'Loading base map tiles…'
              : 'Map tiles unavailable. Terrain and trails are still available.'}
          </Text>
          {tileStatus === 'unavailable' && (
            <Pressable
              accessibilityRole="button"
              style={styles.action}
              onPress={() => {
                setTileStatus('loading');
                inject('retryTiles');
              }}
            >
              <Text style={styles.link}>Retry map tiles</Text>
            </Pressable>
          )}
        </View>
      )}
      {(!hasTrails || status !== 'ready') && (
        <View style={styles.cover} accessibilityLiveRegion="polite">
          {hasTrails && status === 'loading' ? (
            <>
              <ActivityIndicator accessibilityLabel="Loading 3D terrain" />
              <Text style={styles.text}>Building 3D terrain…</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>
                {!hasTrails
                  ? '3D trails unavailable'
                  : status === 'unsupported'
                    ? '3D is unavailable on this device'
                    : '3D terrain could not load'}
              </Text>
              <Text style={styles.text}>
                {!hasTrails
                  ? 'Connect to load preserve trails within the elevation coverage.'
                  : 'Try again or use the 2D map to continue browsing.'}
              </Text>
              {!hasTrails && (
                <Pressable accessibilityRole="button" style={styles.action} onPress={onRetryTrails}>
                  <Text style={styles.link}>Retry trails</Text>
                </Pressable>
              )}
              {hasTrails && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.action}
                  onPress={() => {
                    setAttempt((n) => n + 1);
                    setStatus('loading');
                  }}
                >
                  <Text style={styles.link}>Retry 3D</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" style={styles.action} onPress={onReturnTo2d}>
                <Text style={styles.link}>Use 2D map</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#e4ebef' },
  cover: {
    position: 'absolute',
    top: '25%',
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#ffffffed',
  },
  title: { color: '#1c1c1e', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  text: { color: '#3a3a3c', fontSize: 15, textAlign: 'center' },
  action: { minHeight: 44, justifyContent: 'center' },
  link: { color: '#007aff', fontSize: 16 },
  tileNotice: {
    position: 'absolute',
    top: 170,
    left: 16,
    right: 84,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffffed',
    gap: 6,
  },
});
