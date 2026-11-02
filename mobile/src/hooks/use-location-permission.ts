import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

export type LocationAccess =
  | 'checking'
  | 'undetermined'
  | 'denied'
  | 'blocked'
  | 'granted'
  | 'services-disabled'
  | 'unavailable';

// Permission readiness only: this hook never requests, stores, or transmits a GPS fix.
export function useLocationPermission(active = true) {
  const [approximate, setApproximate] = useState<boolean | null>(null);
  const [status, setStatus] = useState<LocationAccess>('checking');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const requesting = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');

  const check = useCallback(function check(request = false): Promise<void> {
    if (requesting.current) return Promise.resolve();
    requesting.current = request;
    const current = ++generation.current;
    return readAccess(request)
      .then((next) => {
        if (mounted.current && generation.current === current) {
          setStatus(next.status);
          setApproximate(next.approximate);
        }
      })
      .catch(() => {
        // Native error strings can carry sensitive context. Never log or render them.
        if (mounted.current && generation.current === current) setStatus('unavailable');
      })
      .finally(() => {
        if (request) {
          requesting.current = false;
          // Native prompts can background the app. Re-read after a superseded prompt,
          // without showing a second prompt or trusting its late result.
          if (mounted.current && foreground.current && generation.current !== current) void check();
        }
        if (mounted.current && generation.current === current) setBusy(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (active && AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
      void check();
    // Reset access when the external navigation lifecycle deactivates this screen.
    else setStatus('checking');
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (state === 'active' && active) void check();
      else {
        ++generation.current;
        setStatus('checking');
      }
    });
    return () => {
      mounted.current = false;
      // Invalidate pending native reads across focus changes and unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current;
      subscription.remove();
    };
  }, [check, active]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      if (mounted.current) setStatus('unavailable');
    }
  }, []);

  const run = (request: boolean) => {
    if (requesting.current) return Promise.resolve();
    setBusy(true);
    return check(request);
  };

  return { status, approximate, busy, request: () => run(true), refresh: check, openSettings };
}

async function readAccess(
  request: boolean,
): Promise<{ status: LocationAccess; approximate: boolean | null }> {
  const permission = request
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (permission.granted) {
    return {
      status: (await Location.hasServicesEnabledAsync()) ? 'granted' : 'services-disabled',
      approximate: permission.ios
        ? permission.ios.accuracy === 'reduced'
        : permission.android
          ? permission.android.accuracy === 'coarse'
          : null,
    };
  }
  return {
    status: !permission.canAskAgain
      ? 'blocked'
      : permission.status === 'undetermined'
        ? 'undetermined'
        : 'denied',
    approximate: null,
  };
}
