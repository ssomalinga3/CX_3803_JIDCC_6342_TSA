import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TrailLegendEntry } from '@/data/trail-presentation';

export function TrailLegend({ entries }: { entries: TrailLegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trail colors · Swipe for more</Text>
      <ScrollView
        horizontal
        style={styles.list}
        contentContainerStyle={styles.rows}
        showsHorizontalScrollIndicator={false}
      >
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
            <Text style={styles.label}>{entry.name.replace(/ Trails?$/, '')}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#1c1c1e' },
  list: { flexGrow: 0 },
  rows: { gap: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  casing: { width: 22, height: 7, justifyContent: 'center', paddingHorizontal: 2 },
  swatch: { borderTopWidth: 3, width: 18 },
  label: { fontSize: 12, lineHeight: 16, color: '#3a3a3c' },
});
