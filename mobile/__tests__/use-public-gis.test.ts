import { act, renderHook, waitFor } from '@testing-library/react-native';

import { collection, layer } from './fixtures/gis';

import { collectionBounds } from '@/data/gis';
import { usePublicGis } from '@/hooks/use-public-gis';

jest.mock('@/data/gis', () => ({ ...jest.requireActual('@/data/gis'), loadPublicGis: jest.fn() }));
const { loadPublicGis } = jest.requireMock('@/data/gis');
const snapshot = {
  layers: [layer],
  collection,
  bounds: collectionBounds(collection),
  isDemo: true,
};
beforeEach(() => loadPublicGis.mockReset());

test('missing configuration leaves browsing available without API requests', async () => {
  const { result } = await renderHook(() => usePublicGis(undefined));
  expect(result.current.status).toBe('unconfigured');
  expect(loadPublicGis).not.toHaveBeenCalled();
});

test('failure can recover by retrying the same endpoint', async () => {
  loadPublicGis
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce(snapshot);
  const { result } = await renderHook(() => usePublicGis('http://localhost:8787/api/v1'));
  await waitFor(() => expect(result.current.status).toBe('error'));
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.snapshot).toEqual(snapshot);
});

test('empty public layers are distinct from connection failure', async () => {
  loadPublicGis.mockResolvedValueOnce({
    ...snapshot,
    collection: { type: 'FeatureCollection', features: [] },
    bounds: null,
  });
  const { result } = await renderHook(() => usePublicGis('http://localhost:8787/api/v1'));
  await waitFor(() => expect(result.current.status).toBe('empty'));
});

test('changing endpoints cancels the old request and ignores its late response', async () => {
  let resolveOld: (value: typeof snapshot) => void = () => {};
  loadPublicGis
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...snapshot, layers: [] });
  const { result, rerender } = await renderHook(
    (props: { url: string }) => usePublicGis(props.url),
    {
      initialProps: { url: 'http://localhost:8787/api/v1' },
    },
  );
  const oldSignal = loadPublicGis.mock.calls[0][1];
  await rerender({ url: 'http://localhost:8788/api/v1' });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => resolveOld(snapshot));
  expect(oldSignal.aborted).toBe(true);
  expect(result.current.snapshot?.layers).toEqual([]);
});

test('a stalled request times out and is aborted', async () => {
  jest.useFakeTimers();
  loadPublicGis.mockImplementationOnce(() => new Promise(() => {}));
  try {
    const { result, unmount } = await renderHook(() =>
      usePublicGis('http://localhost:8787/api/v1'),
    );
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(result.current.status).toBe('error');
    expect(loadPublicGis.mock.calls[0][1].aborted).toBe(true);
    await unmount();
  } finally {
    jest.useRealTimers();
  }
});
