import { useEffect, useState } from 'react';

import { loadPublicGis, type GisSnapshot } from '@/data/gis';
import { readPublicGisCache, savePublicGisCache } from '@/data/gis-cache';

export type GisState =
  | { status: 'unconfigured' | 'loading' | 'error'; snapshot?: never; savedAt?: never }
  | { status: 'ready' | 'empty'; snapshot: GisSnapshot; savedAt?: number };

function available(snapshot: GisSnapshot, savedAt?: number): GisState {
  return { status: snapshot.collection.features.length ? 'ready' : 'empty', snapshot, savedAt };
}

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
    const cached = readPublicGisCache(apiUrl);
    if (cached) setState(available(cached.snapshot, cached.savedAt));
    const fallback: GisState = cached
      ? available(cached.snapshot, cached.savedAt)
      : { status: 'error' };
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (active) setState(fallback);
      controller.abort();
    }, 10000);
    loadPublicGis(apiUrl, controller.signal)
      .then((snapshot) => {
        if (active && !controller.signal.aborted) {
          savePublicGisCache(apiUrl, snapshot);
          setState(available(snapshot));
        }
      })
      .catch(() => {
        if (active) setState(fallback);
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
