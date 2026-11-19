import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export function reportRetryDelay(attempt: number, serverDelay: number): number {
  return Math.max(serverDelay, Math.min(300_000, 30_000 * 2 ** Math.min(attempt, 4)));
}

/** The draft provider owns the upload mutex and durable, reviewed submission identity. */
export function useReportReconnect(eligible: boolean, retryAt: number, retry: () => Promise<void>) {
  const latestRetry = useRef(retry);
  useEffect(() => {
    latestRetry.current = retry;
  }, [retry]);
  useEffect(() => {
    if (!eligible) return;
    let active = AppState.currentState === 'active' || AppState.currentState === null;
    let disposed = false;
    let fired = false;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    function schedule() {
      clearTimeout(timer);
      if (disposed || fired || !active || !connected) return;
      timer = setTimeout(
        () => {
          if (disposed || fired || !active || !connected) return;
          if (Date.now() < retryAt) {
            schedule();
            return;
          }
          fired = true;
          void latestRetry.current().catch(() => {
            // The provider retains the draft and exposes safe failure feedback.
          });
        },
        Math.max(1000, retryAt - Date.now()),
      );
    }
    function networkChanged(state: Network.NetworkState) {
      generation += 1;
      connected = state.isConnected === true && state.isInternetReachable !== false;
      schedule();
    }
    async function refresh() {
      const current = generation;
      try {
        const state = await Network.getNetworkStateAsync();
        if (!disposed && current === generation) networkChanged(state);
      } catch {
        if (!disposed && current === generation) {
          connected = false;
          schedule();
        }
      }
    }
    const network = Network.addNetworkStateListener(networkChanged);
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        active = false;
        clearTimeout(timer);
      } else if (state === 'active') {
        active = true;
        void refresh();
      }
    });
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      network.remove();
      lifecycle.remove();
    };
  }, [eligible, retryAt]);
}
