import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { LocationObject } from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type Padding = { top: number; bottom: number; left: number; right: number };

export function useLocationFollow(
  camera: RefObject<CameraRef | null>,
  map: RefObject<MapRef | null>,
  fix: LocationObject | undefined,
  ready: boolean,
  padding: Padding,
  defaultZoom: number,
) {
  const [following, setFollowing] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const latest = useRef({ fix, ready, padding });
  // Reset the selection before rendering unavailable location/map controls.
  if (following && (!fix || !ready)) setFollowing(false);
  const stop = useCallback(() => {
    generation.current += 1;
    active.current = false;
    setFollowing(false);
  }, []);

  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    latest.current = { fix, ready, padding };
    if (!fix || !ready) {
      generation.current += 1;
      active.current = false;
    } else if (active.current) {
      // Omit zoom/bearing/pitch: fresh fixes move the center without resetting
      // the visitor's chosen scale or interrupting zoom-button adjustments.
      camera.current?.easeTo({
        center: [fix.coords.longitude, fix.coords.latitude],
        padding,
        duration: 300,
      });
    }
  }, [camera, fix, ready, padding]);

  async function recenter() {
    if (!latest.current.fix || !latest.current.ready) return;
    const request = ++generation.current;
    try {
      const zoom = await map.current?.getZoom();
      const current = latest.current;
      // A drag, blur, lost fix, or newer tap can supersede the native query.
      if (request !== generation.current || !current.fix || !current.ready) return;
      if (zoom === undefined || !Number.isFinite(zoom)) return;
      camera.current?.easeTo({
        center: [current.fix.coords.longitude, current.fix.coords.latitude],
        zoom: Math.max(defaultZoom, zoom),
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
  }

  return { following, recenter, stop };
}
