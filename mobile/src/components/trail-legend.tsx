import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TrailLegendEntry } from '@/data/trail-presentation';

export function TrailLegend({ entries }: { entries: TrailLegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trail colors · Scroll for more</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.rows} nestedScrollEnabled>
        {entries.map((entry) => (
          <View
            key={entry.id}
            accessible
            accessibilityLabel={`${entry.name}: ${entry.colorName}`}
            style={styles.row}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.casing, { backgroundColor: entry.casing }]}
            >
              <View
                style={[
                  styles.swatch,
                  { borderColor: entry.color, borderStyle: entry.dashed ? 'dashed' : 'solid' },
                ]}
              />
            </View>
            <Text style={styles.label}>{entry.name}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  title: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#1c1c1e' },
  list: { maxHeight: 96, flexGrow: 0 },
  rows: { gap: 6, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  casing: { width: 32, height: 9, justifyContent: 'center', paddingHorizontal: 2 },
  swatch: { borderTopWidth: 4, width: 28 },
  label: { flex: 1, fontSize: 13, lineHeight: 19, color: '#3a3a3c' },
});
