export function offlineStyleUrl(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.hostname !== 'openfreemap.org' &&
      !url.hostname.endsWith('.openfreemap.org')
    ) {
      return url.href;
    }
  } catch {
    // Invalid configuration leaves the prototype disabled.
  }
}

export const OFFLINE_STYLE = offlineStyleUrl(process.env.EXPO_PUBLIC_OFFLINE_MAP_STYLE_URL);
