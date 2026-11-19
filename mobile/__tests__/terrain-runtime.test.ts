import { waitFor } from '@testing-library/react-native';
import type { StyleSpecification } from 'maplibre-gl';

import { terrainDocument } from '@/data/terrain-3d-html';

const { runInNewContext } = jest.requireActual('node:vm');

test.each([false, true])(
  'drapes selected tiles, recovers failure and disposes resources (Android visibility cleanup: %s)',
  async (disposeWhenHidden) => {
    const styles: StyleSpecification[] = [];
    const events: Record<string, (event?: unknown) => void> = {};
    const positionData = jest.fn();
    const remove = jest.fn();
    const visibilityEvents: Record<string, () => void> = {};
    const browserDocument = {
      hidden: false,
      addEventListener: (event: string, listener: () => void) => {
        visibilityEvents[event] = listener;
      },
    };
    const messages: { type: string; status?: string }[] = [];
    class MapDouble {
      touchZoomRotate = { enableRotation: jest.fn() };
      touchPitch = { enable: jest.fn() };
      constructor({ style }: { style: StyleSpecification }) {
        styles.push(style);
      }
      addControl() {}
      on(event: string, callback: (value?: unknown) => void) {
        events[event] = callback;
      }
      setStyle(style: StyleSpecification) {
        styles.push(style);
      }
      isSourceLoaded() {
        return true;
      }
      isStyleLoaded() {
        return true;
      }
      getSource() {
        return { setData: positionData };
      }
      getLayer() {
        return {};
      }
      getLayoutProperty() {
        return 'visible';
      }
      setLayoutProperty() {}
      remove = remove;
    }
    const selectedStyle: StyleSpecification = {
      version: 8,
      sources: {
        selected: { type: 'raster', tiles: ['https://basemap.nationalmap.gov/tiles/{z}/{y}/{x}'] },
      },
      layers: [
        { id: 'base-background', type: 'background' },
        { id: 'base-tiles', type: 'raster', source: 'selected' },
        { id: 'base-labels', type: 'symbol', source: 'selected' },
      ],
    };
    const runtimeWindow: {
      addEventListener: () => void;
      ReactNativeWebView: { postMessage: (value: string) => void };
      cascade3d?: { position: (value: number[]) => void; dispose: () => void };
    } = {
      addEventListener: () => {},
      ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) },
    };
    const html = terrainDocument(
      { type: 'FeatureCollection', features: [] },
      'runtime-test',
      undefined,
      undefined,
      disposeWhenHidden,
    );
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
    try {
      runInNewContext(script, {
        window: runtimeWindow,
        document: browserDocument,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        devicePixelRatio: 1,
        performance: { now: () => 1000 },
        fetch: async () => ({ ok: true, text: async () => JSON.stringify(selectedStyle) }),
        maplibregl: {
          Map: MapDouble,
          NavigationControl: class {},
          setWorkerCount: jest.fn(),
          addProtocol: jest.fn(),
          removeProtocol: jest.fn(),
          clearPrewarmedResources: jest.fn(),
        },
      });
      events.idle();
      await waitFor(() => expect(styles).toHaveLength(2));
      const painted = styles[1];
      expect(painted.layers.map((layer) => layer.id)).toEqual([
        'base-background',
        'surface',
        'base-tiles',
        'terrain-hillshade',
        'base-labels',
        'trail-casing',
        'trail-solid',
        'trail-dashed',
        'device-position',
      ]);
      expect(painted.sources.hillshade.type).toBe('raster-dem');
      expect(painted.terrain?.exaggeration).toBe(1);
      runtimeWindow.cascade3d!.position([-84.479, 33.717]);
      positionData.mockClear();
      events['style.load']();
      expect(positionData).toHaveBeenCalledWith(
        expect.objectContaining({
          features: [
            expect.objectContaining({
              geometry: { type: 'Point', coordinates: [-84.479, 33.717] },
            }),
          ],
        }),
      );
      events.idle();
      expect(messages.at(-1)).toMatchObject({ type: 'tiles', status: 'ready' });
      events.error({ sourceId: 'selected' });
      expect(styles.at(-1)?.sources.selected).toBeUndefined();
      expect(messages.at(-1)).toMatchObject({ type: 'tiles', status: 'unavailable' });
      if (disposeWhenHidden) {
        browserDocument.hidden = true;
        visibilityEvents.visibilitychange();
        expect(remove).toHaveBeenCalledTimes(1);
      } else {
        expect(visibilityEvents.visibilitychange).toBeUndefined();
        expect(remove).not.toHaveBeenCalled();
      }
    } finally {
      runtimeWindow.cascade3d?.dispose();
    }
    expect(remove).toHaveBeenCalledTimes(1);
  },
);
