import { render, screen } from '@testing-library/react-native';
import PreserveMap from '@/components/preserve-map';
import { MapGisProvider } from '@/hooks/map-gis-context';

// Evaluating either payload is forbidden on the default 2D startup path.
jest.mock('../assets/terrain-3d/elevation.json', () => {
  throw new Error('2D startup evaluated the 3D DEM payload');
});
jest.mock('../assets/terrain-3d/renderer.json', () => {
  throw new Error('2D startup evaluated the browser renderer payload');
});

test('2D startup does not evaluate 3D payload modules or create a WebView', async () => {
  await render(
    <MapGisProvider>
      <PreserveMap />
    </MapGisProvider>,
  );
  expect(screen.getByTestId('preserve-map')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
});
