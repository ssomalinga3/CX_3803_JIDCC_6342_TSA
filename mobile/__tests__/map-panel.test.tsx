import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Text, type AppStateStatus } from 'react-native';
import { Gesture, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as Reanimated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { MapPanel } from '@/components/map-panel';

let height: SharedValue<number>;
const tree = (maxHeight = 500) => (
  <MapPanel
    height={height}
    bottom={34}
    maxHeight={maxHeight}
    previewHeight={300}
    summary="Location off"
  >
    <Text>Retained map information</Text>
  </MapPanel>
);
async function drag(dy: number, velocityY = 0, cancel = false) {
  await act(async () => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId('map-panel-pan'), [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: dy, velocityY },
      { state: cancel ? State.CANCELLED : State.END, translationY: dy, velocityY },
    ]);
  });
}
async function measured() {
  await fireEvent(screen.getByTestId('map-panel-header'), 'layout', {
    nativeEvent: { layout: { height: 80 } },
  });
  await fireEvent(screen.getByTestId('map-panel-content'), 'contentSizeChange', 390, 900);
}

beforeEach(() => {
  jest.clearAllMocks();
  // The installed Reanimated Jest adapter uses a value-only shared-value mock.
  height = {
    value: 300,
    get: () => height.value,
    set: (next: number) => {
      height.value = next;
    },
  } as SharedValue<number>;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('buttons and accessibility actions collapse/expand without removing content', async () => {
  await render(tree());
  await measured();
  const content = screen.getByText('Retained map information');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Collapse map details' }));
  expect(height.value).toBe(80);
  expect(screen.getByRole('button', { name: 'Expand map details' })).toBeCollapsed();
  expect(screen.queryByText('Retained map information')).not.toBeOnTheScreen();
  await fireEvent(
    screen.getByRole('button', { name: 'Expand map details' }),
    'accessibilityAction',
    {
      nativeEvent: { actionName: 'expand' },
    },
  );
  expect(height.value).toBe(500);
  expect(screen.getByText('Retained map information')).toBe(content);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show less map information' }));
  expect(height.value).toBe(300);
  await fireEvent(
    screen.getByRole('button', { name: 'Expand map details' }),
    'accessibilityEscape',
  );
  expect(height.value).toBe(80);
});

test('vertical swipes move through stops, long drags clamp and interruptions return to the committed stop', async () => {
  await render(tree());
  await measured();
  await drag(60);
  expect(height.value).toBe(300);
  await drag(160);
  expect(height.value).toBe(80);
  await drag(-160);
  expect(height.value).toBe(300);
  await drag(-160);
  expect(height.value).toBe(500);
  await drag(1000);
  expect(height.value).toBe(80);
  await drag(-100, 0, true);
  expect(height.value).toBe(80);
  await drag(-10, -900);
  expect(height.value).toBe(300);
  await drag(-10, -900);
  expect(height.value).toBe(500);
});

test('header owns the drag; scrolling information does not change the stop', async () => {
  await render(tree());
  await measured();
  const originalHeight = height.value;
  expect(
    screen.getByTestId('map-panel-content').props.onMoveShouldSetResponderCapture,
  ).toBeUndefined();
  await fireEvent.scroll(screen.getByTestId('map-panel-content'), {
    nativeEvent: {
      contentOffset: { y: 100, x: 0 },
      contentSize: { height: 900, width: 390 },
      layoutMeasurement: { height: 220, width: 390 },
    },
  });
  expect(height.value).toBe(originalHeight);
});

test('resizing and larger header text keep the logical stop and clamp to available content', async () => {
  const view = await render(tree());
  await measured();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Expand map details' }));
  await view.rerender(tree(400));
  expect(height.value).toBe(400);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Collapse map details' }));
  await fireEvent(screen.getByTestId('map-panel-header'), 'layout', {
    nativeEvent: { layout: { height: 150 } },
  });
  expect(height.value).toBe(150);
  await fireEvent(
    screen.getByTestId('map-panel-content', { includeHiddenElements: true }),
    'contentSizeChange',
    390,
    100,
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show all map information' }));
  expect(height.value).toBe(250);
});

test('Reduce Motion skips springs and live preference changes cancel an in-progress animation', async () => {
  const listening = jest.spyOn(AccessibilityInfo, 'addEventListener');
  const spring = jest.spyOn(Reanimated, 'withSpring');
  const view = await render(tree());
  const calls = listening.mock.calls as unknown as [string, (enabled: boolean) => void][];
  const index = calls.findIndex(([name]) => name === 'reduceMotionChanged');
  const preference = calls[index][1];
  const remove = jest.spyOn(listening.mock.results[index].value, 'remove');
  await measured();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Collapse map details' }));
  expect(spring).not.toHaveBeenCalled();
  await act(() => preference(false));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show all map information' }));
  expect(spring).toHaveBeenCalled();
  await act(() => preference(true));
  expect(height.value).toBe(500);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test('background interruption settles a partial drag without changing the saved stop', async () => {
  let background!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    background = listener;
    return { remove: jest.fn() };
  });
  await render(tree());
  await measured();
  await act(() => {
    height.value = 210; // A partially tracked frame before the OS interrupts.
    background('background');
  });
  expect(height.value).toBe(300);
});
