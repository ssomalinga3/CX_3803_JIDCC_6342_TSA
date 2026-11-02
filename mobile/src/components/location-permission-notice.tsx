import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocationPermission, type LocationAccess } from '@/hooks/use-location-permission';

const messages: Record<LocationAccess, string> = {
  checking: 'Checking location access…',
  undetermined: 'Location access is optional. You can keep browsing without it.',
  denied: 'Location access denied. You can still browse the map.',
  blocked: 'Location access is off. Allow it in Settings, or keep browsing.',
  granted: 'Location access allowed while using the app.',
  'services-disabled': 'Device location services are off. You can still browse the map.',
  unavailable: 'Location access could not be checked. You can still browse the map.',
};

export default function LocationPermissionNotice() {
  const access = useLocationPermission();
  const canRequest = access.status === 'undetermined' || access.status === 'denied';
  const needsSettings = access.status === 'blocked' || access.status === 'services-disabled';
  const canRefresh = access.status === 'unavailable' || access.status === 'services-disabled';

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      <Text style={styles.message}>{messages[access.status]}</Text>
      <View style={styles.actions}>
        {canRequest && (
          <Action label="Allow location access" busy={access.busy} onPress={access.request} />
        )}
        {needsSettings && (
          <Action label="Open Settings" busy={access.busy} onPress={access.openSettings} />
        )}
        {canRefresh && (
          <Action label="Check location access" busy={access.busy} onPress={access.refresh} />
        )}
      </View>
    </View>
  );
}

function Action({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={() => void onPress()}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  message: { fontSize: 14, lineHeight: 20, color: '#3a3a3c' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#007aff',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
