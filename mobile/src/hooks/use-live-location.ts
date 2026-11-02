import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { useLocationPermission } from './use-location-permission';

// UX freshness only. These values say nothing about safe navigation or trail alignment.
export const FIX_MAX_AGE_MS = 30_000;
export const ACQUISITION_TIMEOUT_MS = 20_000;
const ACCESS_CHECK_INTERVAL_MS = 5_000;
type Fix = { center: [number, number]; timestamp: number; accuracy: number | null };
type Tracking = {
  status: 'idle' | 'acquiring' | 'live' | 'stale' | 'unavailable';
  fix: Fix | null;
};

export function useLiveLocation(active: boolean, access: ReturnType<typeof useLocationPermission>) {
  const [tracking, setTracking] = useState<Tracking>({ status: 'idle', fix: null });
  const [attempt, setAttempt] = useState(0);
  const { status, refresh } = access;
  const enabled = active && status === 'granted';

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let subscription: Location.LocationSubscription | undefined;
    let lastTimestamp = -Infinity;
    let expiry: ReturnType<typeof setTimeout>;
    const stop = () => {
      stopped = true;
      subscription?.remove();
      subscription = undefined;
      clearTimeout(expiry);
    };
    const fail = () => {
      if (stopped) return;
      stop();
      setTracking({ status: 'unavailable', fix: null });
      void refresh();
    };
    // A new native subscription must not display the previous session's fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracking({ status: 'acquiring', fix: null });
    expiry = setTimeout(() => {
      if (!stopped) setTracking({ status: 'unavailable', fix: null });
    }, ACQUISITION_TIMEOUT_MS);
    // No prompt, network provider dialog, last-known fix, or second location provider.
    const start = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (stopped) return;
      const services = permission.granted && (await Location.hasServicesEnabledAsync());
      if (stopped) return;
      if (!services) {
        fail();
        return;
      }
      return Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 0,
          timeInterval: 1000,
          mayShowUserSettingsDialog: false,
        },
        (location) => {
          if (stopped) return;
          const { latitude, longitude, accuracy } = location.coords;
          const timestamp = location.timestamp;
          if (
            !Number.isFinite(latitude) ||
            Math.abs(latitude) > 90 ||
            !Number.isFinite(longitude) ||
            Math.abs(longitude) > 180 ||
            !Number.isFinite(timestamp) ||
            timestamp > Date.now() ||
            timestamp <= lastTimestamp
          )
            return;
          if (Date.now() - timestamp >= FIX_MAX_AGE_MS) {
            // An old callback must never replace a newer current fix.
            if (lastTimestamp === -Infinity) setTracking({ status: 'stale', fix: null });
            return;
          }
          lastTimestamp = timestamp;
          clearTimeout(expiry);
          setTracking({
            status: 'live',
            fix: {
              center: [longitude, latitude],
              timestamp,
              accuracy:
                accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
            },
          });
          expiry = setTimeout(
            () => {
              if (!stopped) setTracking({ status: 'stale', fix: null });
            },
            FIX_MAX_AGE_MS - (Date.now() - timestamp),
          );
        },
        fail,
      );
    };
    void start()
      .then((watch) => {
        if (!watch) return;
        if (stopped) watch.remove();
        else subscription = watch;
      })
      .catch(fail);
    // Recheck permission/services even when a provider silently stops emitting fixes.
    const poll = setInterval(() => {
      if (!stopped) void refresh();
    }, ACCESS_CHECK_INTERVAL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop();
        setTracking({ status: 'idle', fix: null });
      }
    });
    return () => {
      stop();
      clearInterval(poll);
      appState.remove();
    };
  }, [enabled, refresh, attempt]);

  const current = enabled ? tracking : { status: 'idle' as const, fix: null };
  return { ...current, retry: () => setAttempt((value) => value + 1) };
}

// Recheck at the moment of recenter too; timers may run late on a busy JS thread.
export function currentCenter(fix: Fix | null): [number, number] | null {
  return fix && Date.now() - fix.timestamp < FIX_MAX_AGE_MS ? fix.center : null;
}
