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
  const [tracked, setTracked] = useState<{ fix?: LocationObject; state: OffTrailState }>({
    state: INITIAL_OFF_TRAIL,
  });
  const [dismissed, setDismissed] = useState(false);
  const current = locationStatus === 'ready' ? fix : undefined;
  if (tracked.fix !== current) {
    // Any GPS gap (stale, blur, background, off) keeps the confirmed assessment
    // but restarts consecutive-fix confirmation.
    const state = current
      ? nextOffTrailState(tracked.state, geometry, {
          longitude: current.coords.longitude,
          latitude: current.coords.latitude,
          accuracy: current.coords.accuracy,
        })
      : { ...tracked.state, pending: 0 };
    // Derive during render so the indicator never lags a fix by a frame.
    setTracked({ fix: current, state });
    // A fresh fix back on a trail or outside the preserve ends a dismissed departure.
    if (current && state.status !== 'off-trail' && dismissed) setDismissed(false);
  }
  const status: OffTrailStatus = current ? tracked.state.status : 'unknown';

  const [warningHidden, setWarningHidden] = useState(readOffTrailWarningHidden);
  return {
    status,
    showWarning: status === 'off-trail' && !warningHidden && !dismissed,
    /** Close for this time off-trail; the reminder returns after the next departure. */
    dismiss: () => setDismissed(true),
    /** Never show the reminder again on this device. */
    hideForever: () => {
      saveOffTrailWarningHidden(true);
      setWarningHidden(true);
    },
  };
}
