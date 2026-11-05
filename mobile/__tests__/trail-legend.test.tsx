import { fireEvent, render, screen } from '@testing-library/react-native';

import { TrailLegend } from '@/components/trail-legend';

test('edge cues follow overflow and scroll position without visible swipe instructions', async () => {
  await render(
    <TrailLegend
      entries={[
        {
          id: 'gateway',
          name: 'Gateway Trail',
          colorName: 'White',
          color: '#FFFFFF',
          casing: '#444444',
          dashed: false,
        },
      ]}
    />,
  );
  const strip = screen.getByTestId('trail-color-strip');
  await fireEvent(strip, 'layout', { nativeEvent: { layout: { width: 200 } } });
  await fireEvent(strip, 'contentSizeChange', 100, 24);
  expect(
    screen.queryByTestId('trail-key-right-cue', { includeHiddenElements: true }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByTestId('trail-key-left-cue', { includeHiddenElements: true }),
  ).not.toBeOnTheScreen();
  expect(screen.getByText('Trail colors')).toBeOnTheScreen();
  expect(screen.queryByText(/Swipe for more/)).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Gateway Trail: White')).toBeOnTheScreen();

  await fireEvent(strip, 'contentSizeChange', 500, 24);
  expect(
    screen.getByTestId('trail-key-right-cue', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByTestId('trail-key-left-cue', { includeHiddenElements: true }),
  ).not.toBeOnTheScreen();
  await fireEvent.scroll(strip, { nativeEvent: { contentOffset: { x: 100, y: 0 } } });
  expect(
    screen.getByTestId('trail-key-left-cue', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.getByTestId('trail-key-right-cue', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  await fireEvent.scroll(strip, { nativeEvent: { contentOffset: { x: 300, y: 0 } } });
  expect(
    screen.getByTestId('trail-key-left-cue', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByTestId('trail-key-right-cue', { includeHiddenElements: true }),
  ).not.toBeOnTheScreen();
});
