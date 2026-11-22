import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { reportRetryDelay, useReportReconnect } from '@/hooks/use-report-reconnect';

let changeNetwork: (state: Network.NetworkState) => void;
let changeState: (state: AppStateStatus) => void;
const remove = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest
    .mocked(Network.getNetworkStateAsync)
    .mockResolvedValue({ isConnected: false, isInternetReachable: false });
  jest.mocked(Network.addNetworkStateListener).mockImplementation((listener) => {
    changeNetwork = listener;
    return { remove };
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    changeState = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('ignores editable drafts and retries a submitted draft once on reconnect', async () => {
  const retry = jest.fn().mockResolvedValue(undefined);
  const { rerender, unmount } = await renderHook(
    (eligible: boolean) => useReportReconnect(eligible, 0, retry),
    { initialProps: false },
  );
  expect(Network.getNetworkStateAsync).not.toHaveBeenCalled();
  await rerender(true);
  await act(async () => {});
  await act(() => jest.advanceTimersByTime(5000));
  expect(retry).not.toHaveBeenCalled();
  await act(() => changeNetwork({ isConnected: true, isInternetReachable: true }));
  await act(() => jest.advanceTimersByTime(1000));
  expect(retry).toHaveBeenCalledTimes(1);
  await act(() => changeNetwork({ isConnected: true, isInternetReachable: true }));
  await act(() => jest.advanceTimersByTime(1000));
  expect(retry).toHaveBeenCalledTimes(1);
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('honors retry timing and waits until foregrounded', async () => {
  const retry = jest.fn().mockResolvedValue(undefined);
  const deadline = Date.now() + 30_000;
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: true });
  await renderHook(() => useReportReconnect(true, deadline, retry));
  await act(async () => {});
  await act(() => jest.advanceTimersByTime(10_000));
  expect(retry).not.toHaveBeenCalled();
  await act(() => changeState('background'));
  await act(() => jest.advanceTimersByTime(25_000));
  expect(retry).not.toHaveBeenCalled();
  await act(() => changeState('active'));
  await act(async () => {});
  await act(() => jest.advanceTimersByTime(1000));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('bounds exponential backoff while honoring a longer server delay', () => {
  expect(reportRetryDelay(0, 0)).toBe(30_000);
  expect(reportRetryDelay(1, 0)).toBe(60_000);
  expect(reportRetryDelay(20, 0)).toBe(300_000);
  expect(reportRetryDelay(0, 600_000)).toBe(600_000);
});
