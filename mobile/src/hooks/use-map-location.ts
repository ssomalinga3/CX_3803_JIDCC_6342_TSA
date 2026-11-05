import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Display freshness only; this is not an off-trail tolerance or accuracy guarantee.
export const LOCATION_FRESHNESS_MS = 30_000;
type LocationStatus =
  | 'off'
  | 'requesting'
  | 'searching'
  | 'ready'
  | 'stale'
  | 'denied'
  | 'blocked'
  | 'services-disabled'
  | 'unavailable';
type LocationState = {
  status: LocationStatus;
  fix?: Location.LocationObject;
};

export function useMapLocation() {
  const [state, setState] = useState<LocationState>({ status: 'off' });
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestPermission = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || attempt === 0) return;
      let generation = 0;
      let subscription: Location.LocationSubscription | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let started = false;
      const stop = () => {
        generation += 1;
        subscription?.remove();
        subscription = undefined;
        clearTimeout(timer);
      };
      const start = async (mayRequest: boolean) => {
        started = true;
        stop();
        const current = generation;
        const active = () => current === generation;
        setState({ status: 'requesting' });
        try {
          // iOS can report permission as denied while device services are off.
          // Check the device switch first so the recovery message is accurate.
          const servicesEnabled = await Location.hasServicesEnabledAsync();
          if (!active()) return;
          if (!servicesEnabled) {
            setState({ status: 'services-disabled' });
            return;
          }
          let permission = await Location.getForegroundPermissionsAsync();
          if (!active()) return;
          if (!permission.granted && permission.canAskAgain && mayRequest) {
            permission = await Location.requestForegroundPermissionsAsync();
          }
          if (!active()) return;
          if (!permission.granted) {
            setState({ status: permission.canAskAgain ? 'denied' : 'blocked' });
            return;
          }
          setState({ status: 'searching' });
          timer = setTimeout(() => {
            if (active()) setState({ status: 'unavailable' });
          }, LOCATION_FRESHNESS_MS);
          let newestTimestamp = 0;
          const watcher = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
            (fix) => {
              if (!active()) return;
              const { latitude, longitude, accuracy } = fix.coords;
              const age = Date.now() - fix.timestamp;
              if (
                !Number.isFinite(latitude) ||
                Math.abs(latitude) > 90 ||
                !Number.isFinite(longitude) ||
                Math.abs(longitude) > 180 ||
                !Number.isFinite(fix.timestamp) ||
                fix.timestamp <= newestTimestamp ||
                age < -5000 ||
                age >= LOCATION_FRESHNESS_MS ||
                (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))
              )
                return;
              newestTimestamp = fix.timestamp;
              clearTimeout(timer);
              setState({ status: 'ready', fix });
              timer = setTimeout(
                () => {
                  if (active()) setState({ status: 'stale' });
                },
                LOCATION_FRESHNESS_MS - Math.max(0, age),
              );
            },
            () => {
              if (!active()) return;
              stop();
              setState({ status: 'unavailable' });
            },
          );
          // Native subscription creation may finish after blur, background, or retry.
          if (active()) subscription = watcher;
          else watcher.remove();
        } catch {
          if (active()) {
            stop();
            setState({ status: 'unavailable' });
          }
        }
      };
      if (AppState.currentState === 'active' || AppState.currentState === null) {
        void start(requestPermission.current);
        requestPermission.current = false;
      }
      let backgrounded = AppState.currentState === 'background';
      const listener = AppState.addEventListener('change', (next) => {
        // An iOS permission dialog temporarily makes the app inactive. Let that
        // request finish; only backgrounding cancels pending authorization.
        if (next === 'background') {
          backgrounded = true;
          stop();
          setState({ status: 'off' });
        } else if (next === 'active' && (backgrounded || !started)) {
          backgrounded = false;
          void start(requestPermission.current);
          requestPermission.current = false;
        }
      });
      return () => {
        stop();
        listener.remove();
        setState({ status: 'off' });
      };
    }, [enabled, attempt]),
  );

  return {
    ...state,
    enable: () => {
      requestPermission.current = true;
      setEnabled(true);
      setAttempt((value) => value + 1);
    },
    disable: () => {
      setEnabled(false);
      setState({ status: 'off' });
    },
  };
}
