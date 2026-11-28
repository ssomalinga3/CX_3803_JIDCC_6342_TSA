/**
 * The app always renders in light mode, regardless of the device appearance
 * setting. `userInterfaceStyle: "light"` in app.json pins the native UI
 * (system bars, native tabs, alerts, pickers); this hook keeps JavaScript-styled
 * screens on the same palette so the two never disagree.
 */
export type AppColorScheme = 'light';

export function useColorScheme(): AppColorScheme {
  return 'light';
}
