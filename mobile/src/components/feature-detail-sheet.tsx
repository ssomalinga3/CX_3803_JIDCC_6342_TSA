import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FeatureDetails } from '@/data/feature-details';
import { useTheme } from '@/hooks/use-theme';

export function FeatureDetailSheet({
  details,
  onClose,
}: {
  details: FeatureDetails;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      testID="feature-detail-sheet"
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onClose}
    >
      <View
        style={[styles.container, { backgroundColor: theme.background }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
            Feature details
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close feature details"
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {details.title}
            </Text>
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              {details.description}
            </Text>
          </View>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            {details.fields.map(({ label, value }) => (
              <View key={label} style={styles.field}>
                <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
                <Text style={[styles.value, { color: theme.textSecondary }]}>{value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  heading: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#007aff', fontSize: 17, fontWeight: '600' },
  content: { padding: 20, gap: 16 },
  card: { padding: 20, borderRadius: 16, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  description: { fontSize: 16, lineHeight: 24 },
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  value: { fontSize: 16, lineHeight: 24 },
});
