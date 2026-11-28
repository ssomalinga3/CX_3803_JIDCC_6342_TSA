import { renderHook } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import appConfig from '../app.json';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

test('pins the native interface style to light mode', () => {
  expect(appConfig.expo.userInterfaceStyle).toBe('light');
});

test.each(['light', 'dark', null] as const)(
  'uses the light palette when the device appearance is %s',
  async (deviceScheme) => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(deviceScheme);
    const { result } = await renderHook(() => ({ scheme: useColorScheme(), colors: useTheme() }));
    expect(result.current.scheme).toBe('light');
    expect(result.current.colors).toEqual(Colors.light);
  },
);
