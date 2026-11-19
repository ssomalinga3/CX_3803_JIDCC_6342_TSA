import type { LocationObject } from 'expo-location';
import { useMemo, useState } from 'react';

import type { GisSnapshot } from '@/data/gis';
import {
  INITIAL_OFF_TRAIL,
  nextOffTrailState,
  offTrailGeometry,
  type OffTrailState,
  type OffTrailStatus,
} from '@/data/off-trail';
import { readOffTrailWarningHidden, saveOffTrailWarningHidden } from '@/data/off-trail-preference';
import type { LocationStatus } from '@/hooks/use-map-location';

type Tracked = {
  fix: LocationObject | undefined;
  /** The input collection; derived geometry identity is not stable under React Compiler. */
  collection: GisSnapshot['collection'] | undefined;
  state: OffTrailState;
  /** Increments each time the visitor newly leaves the trail. */
  episode: number;
};

/**
 * Evaluates on/off-trail entirely on the device. Coordinates are never sent,
 * stored or logged; only the boolean "don't show again" choice is persisted.
 */
export function useOffTrail(
  fix: LocationObject | undefined,
  locationStatus: LocationStatus,
  collection: GisSnapshot['collection'] | undefined,
) {
  const geometry = useMemo(() => offTrailGeometry(collection), [collection]);
  const [tracked, setTracked] = useState<Tracked>({
    fix: undefined,
    collection: undefined,
    state: INITIAL_OFF_TRAIL,
    episode: 0,
  });
  // A stale fix keeps the last assessment (it may recover); other states end it.
  const keep = locationStatus === 'stale';
  const current = locationStatus === 'ready' ? fix : undefined;
  if (!keep && (tracked.fix !== current || tracked.collection !== collection)) {
    const base = tracked.collection === collection ? tracked.state : INITIAL_OFF_TRAIL;
    const state = current
      ? nextOffTrailState(base, geometry, {
          longitude: current.coords.longitude,
          latitude: current.coords.latitude,
          accuracy: current.coords.accuracy,
        })
      : INITIAL_OFF_TRAIL;
    const leftTrail = state.status === 'off-trail' && tracked.state.status !== 'off-trail';
    // Derive during render so the indicator never lags a fix by a frame.
    setTracked({ fix: current, collection, state, episode: tracked.episode + (leftTrail ? 1 : 0) });
  }
  const status: OffTrailStatus = keep ? 'unknown' : tracked.state.status;

  const [warningHidden, setWarningHidden] = useState(readOffTrailWarningHidden);
  const [dismissedEpisode, setDismissedEpisode] = useState(0);
  return {
    status,
    showWarning: status === 'off-trail' && !warningHidden && dismissedEpisode !== tracked.episode,
    /** Close for this time off-trail; the reminder returns after the next departure. */
    dismiss: () => setDismissedEpisode(tracked.episode),
    /** Never show the reminder again on this device. */
    hideForever: () => {
      saveOffTrailWarningHidden(true);
      setWarningHidden(true);
    },
  };
}
