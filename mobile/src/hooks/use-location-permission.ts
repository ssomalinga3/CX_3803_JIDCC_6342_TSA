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
export function useLocationPermission() {
  const [status, setStatus] = useState<LocationAccess>('checking');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const requesting = useRef(false);

  const check = useCallback((request = false): Promise<void> => {
    if (requesting.current) return Promise.resolve();
    requesting.current = request;
    const current = ++generation.current;
    return readAccess(request)
      .then((next) => {
        if (mounted.current && generation.current === current) setStatus(next);
      })
      .catch(() => {
        // Native error strings can carry sensitive context. Never log or render them.
        if (mounted.current && generation.current === current) setStatus('unavailable');
      })
      .finally(() => {
        if (request) requesting.current = false;
        if (mounted.current && generation.current === current) setBusy(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [check]);

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

  return { status, busy, request: () => run(true), refresh: () => run(false), openSettings };
}

async function readAccess(request: boolean): Promise<LocationAccess> {
  const permission = request
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (permission.granted) {
    return (await Location.hasServicesEnabledAsync()) ? 'granted' : 'services-disabled';
  }
  if (!permission.canAskAgain) return 'blocked';
  return permission.status === 'undetermined' ? 'undetermined' : 'denied';
}
