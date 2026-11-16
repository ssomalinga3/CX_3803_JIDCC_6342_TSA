import { useEffect, useMemo, useRef, useState } from 'react';

import { checkBasemap, type BasemapView } from '@/data/basemap-health';
import { unavailableBasemap, type Basemap } from '@/data/basemaps';

type Status = 'loading' | 'ready' | 'unavailable';

export function useBasemapLoad(basemap: Basemap, view: React.RefObject<BasemapView>) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ basemap, attempt }), [basemap, attempt]);
  const [state, setState] = useState({ request, status: 'loading' as Status });
  const status = state.request === request ? state.status : 'loading';
  const callbacks = useRef<
    | {
        request: typeof request;
        rendered: () => void;
        failed: () => void;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const fail = () => {
      if (active) setState({ request, status: 'unavailable' });
      clearTimeout(timeout);
      controller.abort();
    };
    const timeout = setTimeout(fail, 20000);
    void checkBasemap(basemap, view.current, controller.signal)
      .then(() => {
        // Resource health complements native rendering; neither alone is enough.
        // Readiness below is tracked separately so event order does not matter.
        if (active) checked = true;
        finish();
      })
      .catch(fail);
    let checked = false;
    let rendered = false;
    const finish = () => {
      if (active && checked && rendered) {
        clearTimeout(timeout);
        setState((previous) =>
          previous.request === request && previous.status === 'unavailable'
            ? previous
            : { request, status: 'ready' },
        );
      }
    };
    callbacks.current = {
      request,
      rendered: () => {
        rendered = true;
        finish();
      },
      failed: fail,
    };
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [basemap, request, view]);
  return {
    status,
    style: status === 'unavailable' ? unavailableBasemap : basemap.style,
    rendered: () => {
      if (callbacks.current?.request === request) callbacks.current.rendered();
    },
    failed: () => {
      if (callbacks.current?.request === request) callbacks.current.failed();
    },
    retry: () => setAttempt((value) => value + 1),
  };
}
