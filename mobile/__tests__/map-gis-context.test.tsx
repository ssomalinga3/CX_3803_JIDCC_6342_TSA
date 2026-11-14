import { render, screen, userEvent } from '@testing-library/react-native';
import { Button, Text, View } from 'react-native';
import * as Gis from '@/data/gis';
import { hiddenForPreset } from '@/data/layer-presets';
import { MapGisProvider, useMapGis } from '@/hooks/map-gis-context';
import { layersSnapshot } from './fixtures/layers';

function ReadLayers() {
  const { gis, visibleSnapshot, applyHidden, applyChoices } = useMapGis();
  return (
    <View>
      <Text>{gis.status}</Text>
      <Text>{visibleSnapshot?.layers.map((layer) => layer.layerId).join(',')}</Text>
      <Button title="Hide trails" onPress={() => applyHidden(new Set(['trails', 'private']))} />
      <Button
        title="Use Staff"
        onPress={() => applyChoices('staff', hiddenForPreset(gis.snapshot?.layers ?? [], 'staff'))}
      />
      <Button title="Refresh catalog" onPress={gis.retry} />
    </View>
  );
}

test('shares one GIS load across route content changes; choices survive refresh and new layers default visible', async () => {
  const oldUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8787/api/v1';
  const snapshot = layersSnapshot();
  const load = jest.spyOn(Gis, 'loadPublicGis').mockResolvedValue(snapshot);
  try {
    const tree = (extra = false) => (
      <MapGisProvider>
        {extra && <Text>Another route</Text>}
        <ReadLayers />
      </MapGisProvider>
    );
    const view = await render(tree());
    expect(await screen.findByText('ready')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Use Staff' }));
    expect(load).toHaveBeenCalledTimes(1);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Hide trails' }));
    expect(screen.getByText('landmarks,boundary')).toBeOnTheScreen();
    await view.rerender(tree(true));
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValue({
      ...snapshot,
      layers: [...snapshot.layers, { ...snapshot.layers[1], layerId: 'new-layer' }],
    });
    await userEvent.setup().press(screen.getByRole('button', { name: 'Refresh catalog' }));
    expect(await screen.findByText('landmarks,boundary,new-layer')).toBeOnTheScreen();
    expect(load).toHaveBeenCalledTimes(2);
    load.mockRejectedValueOnce(new Error('offline'));
    await userEvent.setup().press(screen.getByRole('button', { name: 'Refresh catalog' }));
    expect(await screen.findByText('error')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Hide trails' }));
    load.mockResolvedValue(snapshot);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Refresh catalog' }));
    expect(await screen.findByText('landmarks,boundary')).toBeOnTheScreen();
  } finally {
    load.mockRestore();
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = oldUrl;
  }
});
