import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GisSnapshot } from '@/data/gis';
import { featureText } from '@/data/feature-details';
import { useMapGis } from '@/hooks/map-gis-context';
import { useTheme } from '@/hooks/use-theme';
import { OFFLINE_STYLE } from '@/data/offline-basemap';
import { OfflineBasemapControls } from '@/components/offline-basemap-controls';

function returnToMap() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
const descriptions: Record<string, string> = {
  trail: 'Trail routes and named sections.',
  boundary: 'Area outlines and boundaries.',
  landmark: 'Points of interest and landmarks.',
};

export function LayerSelectionScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { gis, hidden, applyHidden } = useMapGis();
  const snapshot = gis.snapshot;
  const [draft, setDraft] = useState<{ snapshot: GisSnapshot; hidden: ReadonlySet<string> }>();
  // A replaced/failed catalog must not apply a draft against obsolete records.
  const current = draft?.snapshot === snapshot ? (draft?.hidden ?? hidden) : hidden;
  const layers = snapshot?.layers ?? [];
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundElement, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { backgroundColor: theme.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Map without applying layers"
          onPress={returnToMap}
          style={styles.action}
        >
          <Text style={styles.actionText}>‹ Map</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply GIS layers"
          disabled={!snapshot}
          onPress={() => {
            applyHidden(current);
            returnToMap();
          }}
          style={styles.action}
        >
          <Text style={[styles.actionText, !snapshot && styles.disabled]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Choose GIS Layers
        </Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Choose what appears on your map.
        </Text>
        {OFFLINE_STYLE && (Platform.OS === 'android' || Platform.OS === 'ios') && (
          <OfflineBasemapControls mapStyle={OFFLINE_STYLE} />
        )}
        {gis.status === 'loading' && (
          <ActivityIndicator accessibilityLabel="Loading GIS layer choices" />
        )}
        {gis.status === 'unconfigured' && (
          <Text style={{ color: theme.textSecondary }}>
            GIS layers are not configured. You can still browse the basemap.
          </Text>
        )}
        {gis.status === 'error' && (
          <View style={styles.status}>
            <Text style={{ color: theme.textSecondary }}>
              GIS layers unavailable. Check your connection.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry GIS layer choices"
              onPress={gis.retry}
              style={styles.action}
            >
              <Text style={styles.actionText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {snapshot && (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.textSecondary }}>
            {layers.filter((layer) => !current.has(layer.layerId)).length} of {layers.length} layers
            selected
          </Text>
        )}
        {snapshot && layers.length === 0 && (
          <Text style={{ color: theme.textSecondary }}>No public GIS layers available.</Text>
        )}
        {layers.map((layer) => {
          const name = featureText(layer.name, 200) || 'GIS layer';
          const pillar = ['Human', 'Social', 'Environmental', 'Economic'].includes(
            layer.pillar ?? '',
          )
            ? layer.pillar
            : null;
          return (
            <View key={layer.layerId} style={[styles.card, { backgroundColor: theme.background }]}>
              <View style={styles.row}>
                <Text style={[styles.name, { color: theme.text }]}>{name}</Text>
                <Switch
                  style={{ minHeight: 44 }}
                  accessibilityLabel={`Show ${name}`}
                  accessibilityHint="Applies when you tap Done"
                  value={!current.has(layer.layerId)}
                  onValueChange={(enabled) => {
                    const next = new Set(current);
                    if (enabled) next.delete(layer.layerId);
                    else next.add(layer.layerId);
                    setDraft({ snapshot: snapshot!, hidden: next });
                  }}
                />
              </View>
              <Text style={[styles.description, { color: theme.textSecondary }]}>
                {Object.hasOwn(descriptions, layer.layerType)
                  ? descriptions[layer.layerType]
                  : 'Features available in this layer.'}
              </Text>
              {pillar && (
                <Text
                  style={[
                    styles.badge,
                    { color: theme.text, backgroundColor: theme.backgroundElement },
                  ]}
                >
                  {pillar}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  action: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  actionText: { color: '#007aff', fontSize: 17, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  description: { fontSize: 16, lineHeight: 23 },
  card: { padding: 18, borderRadius: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: { fontSize: 17, fontWeight: '600', flex: 1 },
  badge: {
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    borderRadius: 10,
  },
  status: { gap: 12 },
});
