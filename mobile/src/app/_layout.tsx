import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { MapGisProvider } from '@/hooks/map-gis-context';
import { ReportDraftProvider } from '@/hooks/report-draft-context';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={DefaultTheme}>
        {/* Dark icons on the light UI; 'auto' would follow a dark device setting. */}
        <StatusBar style="dark" />
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
    </GestureHandlerRootView>
  );
}
