import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Friendly, non-blocking off-trail reminder. The map stays interactive around it.
 * "Got it" is the primary, focused action; "Don't show again" is deliberately quieter.
 */
export function OffTrailWarning({
  onClose,
  onNeverShow,
}: {
  onClose: () => void;
  onNeverShow: () => void;
}) {
  const closeButton = useRef<View>(null);
  useEffect(() => {
    // Move screen-reader focus to the main close action as soon as the card appears.
    const timer = setTimeout(() => {
      if (closeButton.current)
        AccessibilityInfo.sendAccessibilityEvent(closeButton.current, 'focus');
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      testID="off-trail-warning"
      accessibilityLiveRegion="polite"
      accessibilityViewIsModal={false}
      onAccessibilityEscape={onClose}
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.badge}>
          <SymbolView
            name={{ ios: 'leaf.fill', android: 'eco', web: 'eco' }}
            size={22}
            tintColor="#2f6b2f"
            aria-hidden
          />
        </View>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            Looks like you&apos;ve left the trail
          </Text>
          <Text style={styles.body}>Off-trail steps loosen soil and cause erosion.</Text>
        </View>
      </View>
      <Pressable
        ref={closeButton}
        accessibilityRole="button"
        accessibilityLabel="Got it"
        accessibilityHint="Closes this reminder. It returns if you leave a trail again."
        onPress={onClose}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      >
        <Text style={styles.primaryText}>Got it</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Don't show again"
        accessibilityHint="Stops off-trail reminders on this device."
        onPress={onNeverShow}
        hitSlop={8}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryText}>Don&apos;t show again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    // Clear the 52-point map control column (right: 16) so no control covers the card.
    marginRight: 68,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderLeftWidth: 5,
    borderLeftColor: '#4f9a4f',
    boxShadow: '0px 4px 14px rgba(0,0,0,0.16)',
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e3f1df',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 17, fontWeight: '700', color: '#1c1c1e' },
  body: { fontSize: 15, lineHeight: 21, color: '#3a3a3c' },
  primary: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#2f7d32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#60646c', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
