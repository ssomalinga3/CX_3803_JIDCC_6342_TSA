import { useEffect, useState } from 'react';

import { loadPublicGis, type GisSnapshot } from '@/data/gis';

export type GisState =
  | { status: 'unconfigured' | 'loading' | 'error'; snapshot?: never }
  | { status: 'ready' | 'empty'; snapshot: GisSnapshot };

export function usePublicGis(apiUrl: string | undefined) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    url: string | undefined;
    attempt: number;
    state: GisState;
  }>({
    url: apiUrl,
    attempt: 0,
    state: { status: apiUrl ? 'loading' : 'unconfigured' },
  });
  const state: GisState =
    result.url === apiUrl && result.attempt === attempt
      ? result.state
      : { status: apiUrl ? 'loading' : 'unconfigured' };
  useEffect(() => {
    if (!apiUrl) return;
    const setState = (state: GisState) => setResult({ url: apiUrl, attempt, state });
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (active) setState({ status: 'error' });
      controller.abort();
    }, 10000);
    loadPublicGis(apiUrl, controller.signal)
      .then((snapshot) => {
        if (active && !controller.signal.aborted) {
          setState({ status: snapshot.collection.features.length ? 'ready' : 'empty', snapshot });
        }
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [apiUrl, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
