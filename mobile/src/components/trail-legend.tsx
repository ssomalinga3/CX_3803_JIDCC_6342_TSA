import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TrailLegendEntry } from '@/data/trail-presentation';

export function TrailLegend({ entries }: { entries: TrailLegendEntry[] }) {
  const [scroll, setScroll] = useState({ width: 0, content: 0, offset: 0 });
  const hasPrevious = scroll.offset > 1;
  const hasMore = scroll.content - scroll.width - scroll.offset > 1;
  if (entries.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trail colors</Text>
      <View style={styles.strip}>
        <ScrollView
          horizontal
          testID="trail-color-strip"
          accessibilityHint="Scroll horizontally for more trail colors"
          style={styles.list}
          contentContainerStyle={styles.rows}
          showsHorizontalScrollIndicator={false}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setScroll((value) => ({ ...value, width }));
          }}
          onContentSizeChange={(content) => setScroll((value) => ({ ...value, content }))}
          onScroll={(event) => {
            const offset = event.nativeEvent.contentOffset.x;
            setScroll((value) => ({ ...value, offset }));
          }}
          scrollEventThrottle={32}
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
        {hasPrevious && <ScrollCue direction="left" />}
        {hasMore && <ScrollCue direction="right" />}
      </View>
    </View>
  );
}

function ScrollCue({ direction }: { direction: 'left' | 'right' }) {
  return (
    <View
      testID={`trail-key-${direction}-cue`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.cue, direction === 'left' ? styles.leftCue : styles.rightCue]}
    >
      <Text style={styles.chevron}>{direction === 'left' ? '‹' : '›'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#1c1c1e' },
  strip: { position: 'relative' },
  list: { flexGrow: 0, minHeight: 44 },
  rows: { gap: 14, paddingVertical: 4, paddingHorizontal: 14, minHeight: 44, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  casing: { width: 22, height: 7, justifyContent: 'center', paddingHorizontal: 2 },
  swatch: { borderTopWidth: 3, width: 18 },
  label: { fontSize: 12, lineHeight: 16, color: '#3a3a3c' },
  cue: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  leftCue: { left: 0 },
  rightCue: { right: 0 },
  chevron: { fontSize: 18, lineHeight: 22, color: '#8e8e93' },
});
