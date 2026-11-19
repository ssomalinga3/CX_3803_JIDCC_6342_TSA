import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { MapGisProvider } from '@/hooks/map-gis-context';
import { ReportDraftProvider } from '@/hooks/report-draft-context';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <MapGisProvider>
        <ReportDraftProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="layers" options={{ gestureEnabled: true }} />
          </Stack>
        </ReportDraftProvider>
      </MapGisProvider>
    </ThemeProvider>
  );
}
