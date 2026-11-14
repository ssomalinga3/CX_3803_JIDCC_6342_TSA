import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
import { terrainKeys, type TerrainKey } from '@/data/terrain';
import { useMapGis } from '@/hooks/map-gis-context';
import { useTheme } from '@/hooks/use-theme';

function returnToMap() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
const descriptions: Record<string, string> = {
  trail: 'Trail routes and named sections.',
  boundary: 'Area outlines and boundaries.',
  landmark: 'Map symbols and retained source annotations.',
  water: 'Streams and water footprints from the supplied map.',
  natural_area: 'Natural-area footprints from the supplied map.',
  road: 'Road footprints from the supplied map.',
  building: 'Building footprints from the supplied map.',
  terrain: 'Elevation bands and shaded relief.',
};

export function LayerSelectionScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { gis, hidden, terrainSource, applyHidden } = useMapGis();
  const snapshot = gis.snapshot;
  const [draft, setDraft] = useState<{
    snapshot: GisSnapshot;
    hidden: ReadonlySet<string>;
    terrainSource: TerrainKey;
  }>();
  // A replaced/failed catalog must not apply a draft against obsolete records.
  const current = draft?.snapshot === snapshot ? (draft?.hidden ?? hidden) : hidden;
  const currentSource =
    draft?.snapshot === snapshot ? (draft?.terrainSource ?? terrainSource) : terrainSource;
  const layers = snapshot?.layers ?? [];
  const terrainLayers = layers.filter((layer) =>
    terrainKeys.some((key) => layer.layerId === `cascade-terrain-${key}`),
  );
  const otherLayers = layers.filter((layer) => !terrainLayers.includes(layer));
  const elevationEnabled = terrainLayers.some((layer) => !current.has(layer.layerId));
  const choiceCount = otherLayers.length + (terrainLayers.length ? 1 : 0);
  const selectedCount =
    otherLayers.filter((layer) => !current.has(layer.layerId)).length + (elevationEnabled ? 1 : 0);
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
            applyHidden(current, currentSource);
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
            {selectedCount} of {choiceCount} layers selected
          </Text>
        )}
        {snapshot && layers.length === 0 && (
          <Text style={{ color: theme.textSecondary }}>No public GIS layers available.</Text>
        )}
        {otherLayers.map((layer) => {
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
                    setDraft({ snapshot: snapshot!, hidden: next, terrainSource: currentSource });
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
        {snapshot && terrainLayers.length > 0 && (
          <ElevationChoice
            layers={terrainLayers}
            hidden={current}
            source={currentSource}
            onChange={(next, source) => setDraft({ snapshot, hidden: next, terrainSource: source })}
          />
        )}
      </ScrollView>
    </View>
  );
}

const terrainLabels: Record<TerrainKey, string> = { usgs: 'USGS 3DEP', supplied: 'Supplied DTM' };
const terrainLimits: Record<TerrainKey, string> = {
  usgs: 'National public elevation, resampled for display. Source resolution and acquisition dates vary.',
  supplied: 'Supplied park grid. Horizontal datum is unknown; 2015 is inferred from its filename.',
};

function ElevationChoice({
  layers,
  hidden,
  source,
  onChange,
}: {
  layers: GisSnapshot['layers'];
  hidden: ReadonlySet<string>;
  source: TerrainKey;
  onChange: (hidden: ReadonlySet<string>, source: TerrainKey) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const options = (['usgs', 'supplied'] as const).filter((key) =>
    layers.some((layer) => layer.layerId === `cascade-terrain-${key}`),
  );
  const enabled = layers.some((layer) => !hidden.has(layer.layerId));
  function choose(enabled: boolean, selected: TerrainKey) {
    const next = new Set(hidden);
    for (const layer of layers) next.add(layer.layerId);
    if (enabled) next.delete(`cascade-terrain-${selected}`);
    onChange(next, selected);
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.background }]}>
      <View style={styles.row}>
        <Text style={[styles.name, { color: theme.text }]}>Elevation</Text>
        <Switch
          style={{ minHeight: 44 }}
          accessibilityLabel="Show Elevation"
          accessibilityHint="Applies when you tap Done"
          value={enabled}
          onValueChange={(value) => choose(value, source)}
        />
      </View>
      <Text style={[styles.description, { color: theme.textSecondary }]}>
        Elevation bands and shaded relief.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose elevation source"
        accessibilityValue={{ text: terrainLabels[source] }}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={[styles.sourceButton, { borderColor: theme.textSecondary }]}
      >
        <Text style={[styles.sourceLabel, { color: theme.text }]}>
          Source: {terrainLabels[source]}
        </Text>
        <Text style={{ color: theme.text }} aria-hidden>
          {expanded ? '⌃' : '⌄'}
        </Text>
      </Pressable>
      {expanded && (
        <View style={styles.sourceOptions}>
          {options.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityLabel={`Use ${terrainLabels[key]} elevation`}
              accessibilityHint={terrainLimits[key]}
              accessibilityState={{ checked: source === key }}
              onPress={() => {
                choose(enabled, key);
                setExpanded(false);
              }}
              style={[styles.sourceOption, { backgroundColor: theme.backgroundElement }]}
            >
              <Text style={[styles.sourceLabel, { color: theme.text }]}>
                {source === key ? '●' : '○'} {terrainLabels[key]}
              </Text>
              <Text style={[styles.description, { color: theme.textSecondary }]}>
                {terrainLimits[key]}
              </Text>
            </Pressable>
          ))}
          <Text style={[styles.sourceLabel, { color: theme.text }]}>Why they look similar</Text>
          <Text style={[styles.description, { color: theme.textSecondary }]}>
            Both map the same hills. In our sample, 90% of height differences were within about 13
            inches, much smaller than the 20-foot bands. Similar colors and shading are expected.
            Shared survey data is possible but unconfirmed.
          </Text>
        </View>
      )}
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
  sourceButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sourceLabel: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  sourceOptions: { gap: 12 },
  sourceOption: { minHeight: 44, padding: 12, borderRadius: 10, gap: 6 },
});
