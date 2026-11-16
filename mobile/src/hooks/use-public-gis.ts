import { useEffect, useRef, useState } from 'react';

import { loadPublicGis, type GisSnapshot } from '@/data/gis';
import { readPublicGisCache, savePublicGisCache } from '@/data/gis-cache';

export type GisState =
  | {
      status: 'unconfigured' | 'loading' | 'error';
      snapshot?: never;
      savedAt?: never;
      refreshFailed?: never;
    }
  | { status: 'ready' | 'empty'; snapshot: GisSnapshot; savedAt?: number; refreshFailed?: boolean };

function available(snapshot: GisSnapshot, savedAt?: number): GisState {
  return { status: snapshot.collection.features.length ? 'ready' : 'empty', snapshot, savedAt };
}

export function usePublicGis(apiUrl: string | undefined) {
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<{ url: string; state: GisState } | undefined>(undefined);
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
    result.url === apiUrl && (result.attempt === attempt || result.state.snapshot)
      ? result.state
      : { status: apiUrl ? 'loading' : 'unconfigured' };
  useEffect(() => {
    if (!apiUrl) return;
    const setState = (state: GisState) => {
      if (state.snapshot) latest.current = { url: apiUrl, state };
      setResult({ url: apiUrl, attempt, state });
    };
    // A successful network response can be newer than disk when a write failed
    // or exceeded the cache budget. Never replace it with an older saved copy.
    const previous = latest.current?.url === apiUrl ? latest.current.state : undefined;
    const cached = previous?.snapshot ? undefined : readPublicGisCache(apiUrl);
    const retained = previous?.snapshot
      ? previous
      : cached
        ? available(cached.snapshot, cached.savedAt)
        : undefined;
    if (retained) setState({ ...retained, refreshFailed: false });
    const fallback: GisState = retained
      ? { ...retained, refreshFailed: true }
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
