import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors, Spacing } from '@/constants/theme';

type Stop = 0 | 1 | 2;

/** The header owns a native UI-thread pan; content scrolling and map gestures stay independent. */
export function MapPanel({
  height,
  maxHeight,
  previewHeight,
  bottom,
  summary,
  children,
}: {
  height: SharedValue<number>;
  maxHeight: number;
  previewHeight: number;
  bottom: number;
  summary: string;
  children: ReactNode;
}) {
  const [stop, setStop] = useState<Stop>(1);
  const expanded = stop !== 0;
  const [headerHeight, setHeaderHeight] = useState(72);
  const [contentHeight, setContentHeight] = useState<number>();
  const expandedHeight = Math.max(
    headerHeight,
    Math.min(maxHeight, headerHeight + (contentHeight ?? maxHeight)),
  );
  const middleHeight = Math.max(headerHeight, Math.min(previewHeight, expandedHeight));
  const committed = useSharedValue<Stop>(1);
  const dragStart = useSharedValue(previewHeight);
  const reducedMotion = useSharedValue(true);

  const recordStop = useCallback((next: Stop) => {
    setStop(next);
  }, []);

  const settle = useCallback(
    (next: Stop, animate = true) => {
      cancelAnimation(height);
      committed.set(next);
      recordStop(next);
      const target = next === 2 ? expandedHeight : next === 1 ? middleHeight : headerHeight;
      height.set(
        !animate || reducedMotion.get()
          ? target
          : withSpring(target, {
              stiffness: 320,
              damping: 36,
              mass: 1,
              overshootClamping: true,
            }),
      );
    },
    [committed, expandedHeight, headerHeight, height, middleHeight, recordStop, reducedMotion],
  );

  useEffect(() => {
    let active = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      changed = true;
      reducedMotion.set(enabled);
      if (enabled) settle(committed.get(), false);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !changed) reducedMotion.set(enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
      listener.remove();
    };
  }, [committed, reducedMotion, settle]);

  // Only geometry changes settle again; a React state update after a native
  // release must not cancel the spring that is already running on the UI thread.
  useEffect(() => {
    cancelAnimation(height);
    const current = committed.get();
    height.set(current === 2 ? expandedHeight : current === 1 ? middleHeight : headerHeight);
  }, [committed, expandedHeight, headerHeight, height, middleHeight]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') settle(committed.get(), false);
    });
    return () => subscription.remove();
  }, [committed, settle]);
  useEffect(() => () => cancelAnimation(height), [height]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('map-panel-pan')
        .maxPointers(1)
        .activeOffsetY([-8, 8])
        .failOffsetX([-16, 16])
        .onStart(() => {
          cancelAnimation(height);
          dragStart.set(height.get());
        })
        .onUpdate((event) => {
          height.set(
            Math.max(headerHeight, Math.min(expandedHeight, dragStart.get() - event.translationY)),
          );
        })
        .onEnd((event) => {
          const stops = [headerHeight, middleHeight, expandedHeight];
          // Distance selects the closest stop. Limit projection to avoid imprecise
          // multi-stop jumps from a noisy release velocity.
          const projected = height.get() - Math.max(-80, Math.min(80, event.velocityY * 0.12));
          let next = 0;
          for (let index = 1; index < stops.length; index++) {
            if (Math.abs(stops[index] - projected) < Math.abs(stops[next] - projected))
              next = index;
          }
          if (Math.abs(event.velocityY) > 650 && Math.abs(event.translationY) > 8) {
            next =
              event.velocityY < 0
                ? Math.max(next, Math.min(2, committed.get() + 1))
                : Math.min(next, Math.max(0, committed.get() - 1));
          }
          committed.set(next as Stop);
          height.set(
            reducedMotion.get()
              ? stops[next]
              : withSpring(stops[next], {
                  stiffness: 320,
                  damping: 36,
                  mass: 1,
                  overshootClamping: true,
                }),
          );
          scheduleOnRN(recordStop, next as Stop);
        })
        .onFinalize((_event, success) => {
          if (!success) {
            const target =
              committed.get() === 2
                ? expandedHeight
                : committed.get() === 1
                  ? middleHeight
                  : headerHeight;
            height.set(
              reducedMotion.get()
                ? target
                : withSpring(target, {
                    stiffness: 320,
                    damping: 36,
                    mass: 1,
                    overshootClamping: true,
                  }),
            );
          }
        }),
    [
      committed,
      dragStart,
      expandedHeight,
      headerHeight,
      height,
      middleHeight,
      recordStop,
      reducedMotion,
    ],
  );

  const physicalHeight = Math.max(maxHeight, headerHeight);
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: physicalHeight - height.get() }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({ height: Math.max(0, height.get() - headerHeight) }));

  return (
    <Animated.View
      testID="map-panel"
      style={[styles.panel, { height: physicalHeight, bottom }, panelStyle]}
    >
      <GestureDetector gesture={pan}>
        <View testID="map-panel-drag-handle" collapsable={false}>
          <View
            testID="map-panel-header"
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
            style={styles.header}
          >
            <View style={styles.grabber} aria-hidden />
            <View style={styles.headingRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={stop === 2 ? 'Show less map information' : 'Expand map details'}
                accessibilityHint="Swipe down to collapse or up to expand. Double-tap to toggle."
                accessibilityState={{ expanded }}
                accessibilityValue={{ text: summary }}
                accessibilityActions={[{ name: 'expand' }, { name: 'collapse' }]}
                onAccessibilityAction={(event) =>
                  settle(event.nativeEvent.actionName === 'expand' ? 2 : 0)
                }
                onAccessibilityEscape={() => settle(0)}
                onPress={() => settle(stop === 2 ? 1 : stop === 1 ? 2 : 1)}
                style={({ pressed }) => [
                  styles.headingText,
                  styles.headerButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.title}>Map details</Text>
                <Text style={styles.summary}>{summary}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Collapse map details' : 'Show all map information'}
                onPress={() => settle(expanded ? 0 : 2)}
                style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
              >
                <Text style={styles.action}>{expanded ? 'Collapse' : 'More'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </GestureDetector>
      <Animated.View
        style={bodyStyle}
        pointerEvents={expanded ? 'auto' : 'none'}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      >
        <ScrollView
          testID="map-panel-content"
          contentContainerStyle={styles.content}
          onContentSizeChange={(_width, nextHeight) => setContentHeight(nextHeight)}
          bounces={false}
          scrollEnabled={expanded}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    minHeight: 72,
  },
  pressed: { backgroundColor: Colors.light.backgroundElement },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.light.textSecondary,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headingText: { flex: 1, gap: Spacing.one },
  headerButton: { minHeight: 44, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  summary: { fontSize: 13, color: Colors.light.textSecondary },
  action: { fontSize: 15, color: '#007aff' },
  content: { paddingHorizontal: 18, paddingBottom: 18, gap: Spacing.two },
});
