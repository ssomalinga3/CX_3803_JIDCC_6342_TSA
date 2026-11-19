import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { HEADING_FRESHNESS_MS, headingDegrees, smoothHeading } from '@/data/heading';

export function useMapHeading(enabled: boolean): number | undefined {
  const [heading, setHeading] = useState<number>();
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let generation = 0;
      let subscription: Location.LocationSubscription | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let previous: number | undefined;
      function stop() {
        generation += 1;
        subscription?.remove();
        subscription = undefined;
        clearTimeout(timer);
        previous = undefined;
        setHeading(undefined);
      }
      async function start() {
        stop();
        const current = generation;
        try {
          const watcher = await Location.watchHeadingAsync(
            (reading) => {
              if (generation !== current) return;
              clearTimeout(timer);
              const value = headingDegrees(reading);
              previous = value === undefined ? undefined : smoothHeading(previous, value);
              setHeading(previous);
              timer = setTimeout(() => {
                previous = undefined;
                setHeading(undefined);
              }, HEADING_FRESHNESS_MS);
            },
            () => {
              if (generation === current) stop();
            },
          );
          if (current === generation) subscription = watcher;
          else watcher.remove();
        } catch {
          if (current === generation) stop();
        }
      }
      if (AppState.currentState === 'active' || AppState.currentState === null) void start();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'background') stop();
        else if (state === 'active' && !subscription) void start();
      });
      return () => {
        stop();
        listener.remove();
      };
    }, [enabled]),
  );
  return enabled ? heading : undefined;
}
