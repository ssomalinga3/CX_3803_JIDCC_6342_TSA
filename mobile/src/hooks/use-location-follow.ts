import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { LocationObject } from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { LocationStatus } from '@/hooks/use-map-location';

type Padding = { top: number; bottom: number; left: number; right: number };

export function useLocationFollow(
  camera: RefObject<Pick<CameraRef, 'easeTo' | 'zoomTo'> | null>,
  map: RefObject<Pick<MapRef, 'getZoom'> | null>,
  fix: LocationObject | undefined,
  mapStatus: 'loading' | 'ready' | 'unavailable',
  padding: Padding,
  defaultZoom: number,
  status: LocationStatus,
) {
  const ready = mapStatus === 'ready';
  const [following, setFollowing] = useState(false);
  const active = useRef(false);
  const followZoom = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const awaitingFix = useRef(false);
  const latest = useRef({ fix, ready, padding, status });
  // Reset the selection before rendering unavailable location/map controls.
  if (following && (!fix || mapStatus === 'unavailable')) setFollowing(false);
  const stop = useCallback(() => {
    generation.current += 1;
    active.current = false;
    followZoom.current = undefined;
    awaitingFix.current = false;
    setFollowing(false);
  }, []);

  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const recenter = useCallback(async () => {
    if (!latest.current.fix || !latest.current.ready) return;
    const request = ++generation.current;
    try {
      const zoom = await map.current?.getZoom();
      const current = latest.current;
      // A drag, blur, lost fix, or newer tap can supersede the native query.
      if (request !== generation.current || !current.fix || !current.ready) return;
      if (zoom === undefined || !Number.isFinite(zoom)) return;
      followZoom.current = Math.max(defaultZoom, zoom);
      camera.current?.easeTo({
        center: [current.fix.coords.longitude, current.fix.coords.latitude],
        zoom: followZoom.current,
        padding: current.padding,
        bearing: 0,
        pitch: 0,
        duration: 300,
      });
      active.current = true;
      setFollowing(true);
    } catch {
      // A disappearing native map must not produce an unhandled rejection or
      // apply an unknown zoom. The visitor can try recentering again.
      if (request === generation.current) stop();
    }
  }, [camera, map, defaultZoom, stop]);

  useEffect(() => {
    const previousStatus = latest.current.status;
    latest.current = { fix, ready, padding, status };
    if (!fix || mapStatus === 'unavailable') {
      generation.current += 1;
      active.current = false;
      followZoom.current = undefined;
      // Keep an explicit first-tap intent through permission and GPS acquisition,
      // but never resume it after denial, failure, background or a map failure.
      if (
        mapStatus === 'unavailable' ||
        !['off', 'requesting', 'searching'].includes(status) ||
        (status === 'off' && previousStatus !== 'off')
      )
        awaitingFix.current = false;
    } else if (!ready) {
      // Style changes temporarily suspend camera commands, retaining an explicit
      // follow intent. The ready transition recenters on the newest fix.
      generation.current += 1;
    } else if (awaitingFix.current) {
      awaitingFix.current = false;
      void recenter();
    } else if (active.current) {
      // Keep the requested scale if a fix arrives during a zoom animation.
      camera.current?.easeTo({
        center: [fix.coords.longitude, fix.coords.latitude],
        zoom: followZoom.current,
        padding,
        duration: 300,
      });
    }
  }, [camera, fix, ready, mapStatus, padding, status, recenter]);

  function followWhenReady() {
    stop();
    awaitingFix.current = true;
  }

  async function zoomBy(delta: number, minZoom: number, maxZoom: number) {
    const request = generation.current;
    const zoom = await map.current?.getZoom();
    if (request !== generation.current || !latest.current.ready) return;
    if (zoom === undefined || !Number.isFinite(zoom)) return;
    const target = Math.min(maxZoom, Math.max(minZoom, (followZoom.current ?? zoom) + delta));
    const { fix: currentFix, padding: currentPadding } = latest.current;
    if (active.current && currentFix) {
      followZoom.current = target;
      // Zoom and center together, including while GPS is stationary. zoomTo
      // alone uses the map's geometric center rather than the padded GPS anchor.
      camera.current?.easeTo({
        center: [currentFix.coords.longitude, currentFix.coords.latitude],
        zoom: target,
        padding: currentPadding,
        duration: 200,
      });
    } else {
      camera.current?.zoomTo(target, { duration: 200 });
    }
  }

  return { following, recenter, stop, zoomBy, followWhenReady };
}
