import type { OfflinePackStatus } from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { basemapStatus, downloadBasemap, removeBasemap } from '@/data/offline-basemap';
import { useTheme } from '@/hooks/use-theme';

export function OfflineBasemapControls({ mapStyle }: { mapStyle: string }) {
  const theme = useTheme();
  const [status, setStatus] = useState<OfflinePackStatus>();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const operation = useRef(false);
  const state = status?.state;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const current = await basemapStatus(mapStyle);
        if (cancelled) return;
        if (!operation.current) setStatus(current);
        if (current?.state === 'active') timer = setTimeout(() => void refresh(), 1000);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mapStyle, state, busy]);

  async function update(remove: boolean) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (remove) {
        await removeBasemap(mapStyle);
        setStatus(undefined);
      } else {
        setStatus(await downloadBasemap(mapStyle));
      }
    } catch {
      setFailed(true);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  const message = failed
    ? 'Could not update the saved basemap. Try again.'
    : state === 'complete'
      ? 'Preserve basemap saved · Zoom levels 13–16'
      : state === 'active'
        ? 'Downloading preserve basemap…'
        : state === 'inactive'
          ? 'Download incomplete. Reconnect to resume.'
          : 'Save the preserve basemap for offline use.';

  return (
    <View style={[styles.card, { backgroundColor: theme.background }]}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontWeight: '600' }}>
        Offline basemap
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.textSecondary }}>
        {checking ? 'Checking for a saved basemap…' : message}
      </Text>
      {status?.state === 'complete' && (
        <Text style={{ color: theme.textSecondary }}>
          {status.completedTileCount} tiles · {(status.completedResourceSize / 1048576).toFixed(1)}{' '}
          MiB
        </Text>
      )}
      {!checking && (state !== 'active' || failed) && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void update(state === 'complete')}
          style={styles.action}
        >
          <Text style={{ color: theme.text }}>
            {state === 'complete'
              ? 'Remove saved basemap'
              : state === 'inactive'
                ? 'Resume download'
                : 'Download preserve basemap'}
          </Text>
        </Pressable>
      )}
      {!checking && state === 'inactive' && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void update(true)}
          style={styles.action}
        >
          <Text style={{ color: theme.text }}>Remove incomplete download</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, gap: 6, padding: 14 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
