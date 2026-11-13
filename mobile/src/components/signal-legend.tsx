import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { signalClasses } from '@/data/signal';

export function SignalLegend() {
  return (
    <View>
      <Text style={styles.title}>Cell-signal classes</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        accessibilityLabel="Cell-signal class colors"
        accessibilityHint="Scroll horizontally for more signal classes"
        contentContainerStyle={styles.list}
      >
        {signalClasses.map((c) => (
          <View
            key={c.label}
            accessible
            accessibilityLabel={`${c.label}: ${c.color_name}`}
            style={styles.item}
          >
            <View style={[styles.dot, { backgroundColor: c.color }]} />
            <Text style={styles.label}>{c.label}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#1c1c1e' },
  list: { gap: 14, alignItems: 'center', minHeight: 28, paddingBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: '#343434' },
  label: { fontSize: 12, color: '#3a3a3c' },
});
