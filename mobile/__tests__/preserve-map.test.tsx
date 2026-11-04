import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import PreserveMap from '@/components/preserve-map';

const { mockZoomTo, mockEaseTo, mockGetZoom } = jest.requireMock('@maplibre/maplibre-react-native');

beforeEach(() => jest.clearAllMocks());

test('browsing becomes available only after native rendering; zoom follows the current viewport', async () => {
  const user = userEvent.setup();
  await render(<PreserveMap />);
  expect(screen.getByLabelText('Loading map')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.getByText('Browse the map · Location off')).toBeOnTheScreen();
  expect(screen.getByText('Pan or pinch to explore')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mockGetZoom).toHaveBeenCalledTimes(1);
  expect(mockZoomTo).toHaveBeenCalledWith(17, { duration: 200 });
  await user.press(screen.getByRole('button', { name: 'Return to preserve' }));
  expect(mockEaseTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 15, bearing: 0 }));
});

test('failed loading offers retry and can recover without enabling GPS', async () => {
  const user = userEvent.setup();
  await render(<PreserveMap />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
  expect(screen.getByText('Map unavailable. Check your connection.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry loading map' }));
  expect(screen.getByLabelText('Loading map')).toBeOnTheScreen();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.queryByRole('button', { name: 'Retry loading map' })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
});

test('a silent first-load connection failure stops the spinner', async () => {
  jest.useFakeTimers();
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Retry loading map' }));
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(screen.getByText('Map unavailable. Check your connection.')).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});
