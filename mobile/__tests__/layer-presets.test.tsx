import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Button, Text, View } from 'react-native';
import * as Location from 'expo-location';
import NativePreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import {
  hiddenForPreset,
  hiddenWithOverrides,
  visibilityOverrides,
  type LayerPreset,
} from '@/data/layer-presets';
import { visibleGis } from '@/data/layer-visibility';
import { MapGisProvider, useMapGis } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
import { suppliedSnapshot } from './fixtures/supplied-gis';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
const tree = (chooser = true) => (
  <MapGisProvider>
    <NativePreserveMap />
    {chooser && <LayerSelectionScreen />}
  </MapGisProvider>
);
const press = async (name: string, role: 'radio' | 'button' = 'button') =>
  userEvent.setup().press(screen.getByRole(role, { name }));
const preset = async (label: string) => press(`Use ${label} preset`, 'radio');

test.each<[LayerPreset, number, number]>([
  ['visitor', 3, 59],
  ['staff', 8, 102],
  ['researcher', 9, 779],
])('%s selects the intended subset of the real public catalog', (id, layers, features) => {
  const snapshot = suppliedSnapshot();
  const result = visibleGis(snapshot, hiddenForPreset(snapshot.layers, id));
  expect(result.layers).toHaveLength(layers);
  expect(result.collection.features).toHaveLength(features);
  expect(result.layers.some((l) => l.layerId === 'cascade-terrain-supplied')).toBe(false);
  expect(result.layers.some((l) => l.layerId === 'cascade-cell-signal')).toBe(id === 'researcher');
  expect(snapshot.layers).toHaveLength(10);
  expect(snapshot.collection.features).toHaveLength(808);
});

test('Staff and Researcher prefer one available terrain source and leave unclassified content to manual choice', () => {
  const layers = suppliedSnapshot().layers.filter((l) => l.layerId !== 'cascade-terrain-usgs');
  const unknown = { ...layers[0], layerId: 'future-layer', layerType: 'future_kind' };
  for (const mode of ['staff', 'researcher'] as const) {
    const hidden = hiddenForPreset([...layers, unknown], mode);
    expect(hidden.has('cascade-terrain-supplied')).toBe(false);
    expect(hidden.has(unknown.layerId)).toBe(true);
    expect(
      hiddenWithOverrides([...layers, unknown], mode, new Map([[unknown.layerId, true]])).has(
        unknown.layerId,
      ),
    ).toBe(false);
  }
  expect(hiddenForPreset(layers, 'visitor').has('cascade-terrain-supplied')).toBe(true);
});

test('explicit overrides retain identity while new catalog entries follow the chosen preset', () => {
  const layers = suppliedSnapshot().layers;
  const hidden = new Set([
    ...hiddenForPreset(layers, 'staff'),
    'cascade-map-water',
    'private-not-in-catalog',
  ]);
  const overrides = visibilityOverrides(layers, 'staff', hidden);
  expect([...overrides]).toEqual([['cascade-map-water', false]]);
  const added = [
    { ...layers[0], layerId: 'new-water', layerType: 'water' },
    { ...layers[0], layerId: 'unclassified', layerType: 'future_kind' },
  ];
  const next = hiddenWithOverrides([...layers, ...added], 'staff', overrides);
  expect(next.has('cascade-map-water')).toBe(true);
  expect(next.has('new-water')).toBe(false);
  expect(next.has('unclassified')).toBe(true);
  expect(next.has('private-not-in-catalog')).toBe(false);
});

test('Visitor is the initial view; preset drafts cancel on Back and apply with Done without GPS or camera changes', async () => {
  const snapshot = suppliedSnapshot();
  const retry = jest.fn();
  jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({ status: 'ready', snapshot, retry });
  const { mockFitBounds } = jest.requireMock('@maplibre/maplibre-react-native');
  const view = await render(tree());
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  const fits = mockFitBounds.mock.calls.length;
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByRole('radio', { name: 'Use Visitor preset' })).toBeChecked();
  expect(screen.getByText('Public GIS · 3 layers · 59 features')).toBeOnTheScreen();
  await preset('Researcher');
  expect(screen.getByText('9 of 10 layers selected')).toBeOnTheScreen();
  expect(screen.getByText('Public GIS · 3 layers · 59 features')).toBeOnTheScreen();
  await press('Back to Map without applying layers');
  await view.rerender(tree(false));
  await view.rerender(tree());
  expect(screen.getByRole('radio', { name: 'Use Visitor preset' })).toBeChecked();
  await preset('Staff');
  await press('Apply GIS layers');
  expect(screen.getByText('Public GIS · 8 layers · 102 features')).toBeOnTheScreen();
  expect(screen.getByTestId('terrain-usgs')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-supplied')).not.toBeOnTheScreen();
  expect(screen.queryByText('Cell-signal classes')).not.toBeOnTheScreen();
  await preset('Researcher');
  await press('Apply GIS layers');
  expect(screen.getByText('Public GIS · 9 layers · 779 features')).toBeOnTheScreen();
  expect(screen.getByText('Cell-signal classes')).toBeOnTheScreen();
  await preset('Visitor');
  await press('Apply GIS layers');
  expect(screen.getByText('Public GIS · 3 layers · 59 features')).toBeOnTheScreen();
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

test('manual switches customize any preset, can hide everything, and preset selection resets those customizations', async () => {
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: suppliedSnapshot(), retry: jest.fn() });
  await render(tree());
  await fireEvent(
    screen.getByRole('switch', { name: 'Show Cell-signal observations' }),
    'valueChange',
    true,
  );
  expect(screen.getByText('Customized from Visitor')).toBeOnTheScreen();
  expect(
    screen.getAllByRole('radio').every((r) => r.props.accessibilityState.checked === false),
  ).toBe(true);
  await press('Apply GIS layers');
  expect(screen.getByText('Public GIS · 4 layers · 736 features')).toBeOnTheScreen();
  for (const toggle of screen.getAllByRole('switch')) await fireEvent(toggle, 'valueChange', false);
  await press('Apply GIS layers');
  expect(
    screen.getByText('All GIS layers are hidden. Basemap browsing remains available.'),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('public-gis-source').props.data.features).toEqual([]);
  await preset('Visitor');
  await press('Apply GIS layers');
  expect(screen.getByText('Public GIS · 3 layers · 59 features')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Use Visitor preset' })).toBeChecked();
});

test('failed or replaced catalogs cannot apply an obsolete preset draft', async () => {
  const snapshot = suppliedSnapshot();
  const state = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot, retry: jest.fn() });
  const view = await render(tree());
  await preset('Researcher');
  state.mockReturnValue({ status: 'error', retry: jest.fn() });
  await view.rerender(tree());
  expect(screen.queryByRole('radio')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Apply GIS layers' })).toBeDisabled();
  state.mockReturnValue({ status: 'ready', snapshot: { ...snapshot }, retry: jest.fn() });
  await view.rerender(tree());
  expect(screen.getByRole('radio', { name: 'Use Visitor preset' })).toBeChecked();
  expect(screen.getByText('3 of 10 layers selected')).toBeOnTheScreen();
});

function Preferences() {
  const { gis, preset: mode, hidden, visibleSnapshot, applyChoices, applyHidden } = useMapGis();
  return (
    <View>
      <Text testID="preset-mode">{mode}</Text>
      <Text testID="visible-layer-ids">
        {visibleSnapshot?.layers.map((l) => l.layerId).join(',') ?? ''}
      </Text>
      <Button
        title="Choose Staff"
        onPress={() => applyChoices('staff', hiddenForPreset(gis.snapshot?.layers ?? [], 'staff'))}
      />
      <Button
        title="Choose Visitor"
        onPress={() =>
          applyChoices('visitor', hiddenForPreset(gis.snapshot?.layers ?? [], 'visitor'))
        }
      />
      <Button
        title="Hide water"
        onPress={() =>
          applyHidden(new Set([...hidden, 'cascade-map-water', 'private-not-in-catalog']))
        }
      />
    </View>
  );
}

test('applied preset/overrides survive catalog failure and refresh; a new provider starts in Visitor', async () => {
  const snapshot = suppliedSnapshot();
  const state = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot, retry: jest.fn() });
  const content = () => (
    <MapGisProvider>
      <Preferences />
    </MapGisProvider>
  );
  const view = await render(content());
  await press('Choose Staff');
  await press('Hide water');
  const updated = {
    ...snapshot,
    layers: [
      ...snapshot.layers,
      { ...snapshot.layers[0], layerId: 'new-water', layerType: 'water' },
      { ...snapshot.layers[0], layerId: 'future', layerType: 'future_kind' },
    ],
  };
  state.mockReturnValue({ status: 'ready', snapshot: updated, retry: jest.fn() });
  await view.rerender(content());
  const visible = () => String(screen.getByTestId('visible-layer-ids').props.children).split(',');
  expect(visible()).toContain('new-water');
  expect(visible()).not.toContain('cascade-map-water');
  expect(visible()).not.toContain('future');
  state.mockReturnValue({ status: 'error', retry: jest.fn() });
  await view.rerender(content());
  await press('Choose Visitor');
  expect(screen.getByTestId('preset-mode').props.children).toBe('staff');
  state.mockReturnValue({ status: 'ready', snapshot: updated, retry: jest.fn() });
  await view.rerender(content());
  expect(visible()).toContain('new-water');
  expect(visible()).not.toContain('cascade-map-water');
  await view.unmount();
  await render(content());
  expect(screen.getByTestId('preset-mode').props.children).toBe('visitor');
  expect(visible()).toEqual([
    'cascade-map-trails',
    'cascade-map-boundary',
    'cascade-map-landmarks',
  ]);
});
