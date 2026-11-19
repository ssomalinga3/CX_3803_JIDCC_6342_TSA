import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

// Device-local preference only: stores a boolean, never location or trail data.
const FILE_NAME = 'off-trail-warning.json';
const VERSION = 1;

function preferenceFile() {
  return new File(Paths.document, FILE_NAME);
}

export function readOffTrailWarningHidden(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    const file = preferenceFile();
    if (!file.exists || file.size > 1024) return false;
    const value = JSON.parse(file.textSync());
    return value?.version === VERSION && value.hidden === true;
  } catch {
    // A missing or unreadable preference falls back to showing the reminder.
    return false;
  }
}

export function saveOffTrailWarningHidden(hidden: boolean) {
  if (Platform.OS === 'web') return;
  try {
    const file = preferenceFile();
    file.create({ overwrite: true });
    file.write(JSON.stringify({ version: VERSION, hidden }));
  } catch {
    // The choice still applies for this session if storage is unavailable.
  }
}
