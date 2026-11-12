import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  apiBaseUrl,
  assembleGisSnapshot,
  featureUrl,
  parseCatalog,
  parseCollection,
  type GisSnapshot,
} from './gis';

const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_VERSION = 1;
const SLOT_NAMES = ['public-gis-a.json', 'public-gis-b.json'] as const;

type SavedSnapshot = { snapshot: GisSnapshot; savedAt: number };
type Slot = SavedSnapshot & { file: File; apiUrl: string; revision: number };

function readSlot(file: File): Slot | undefined {
  try {
    if (!file.exists || file.size > MAX_BYTES) return;
    const value = JSON.parse(file.textSync());
    if (
      value?.version !== CACHE_VERSION ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !Number.isSafeInteger(value.savedAt) ||
      value.savedAt < 1 ||
      !Array.isArray(value.collections)
    )
      return;
    const base = apiBaseUrl(value.apiUrl);
    const { layers } = parseCatalog(value);
    layers.forEach((layer) => featureUrl(base, layer));
    const snapshot = assembleGisSnapshot(layers, value.collections.map(parseCollection));
    return { file, apiUrl: base.href, revision: value.revision, savedAt: value.savedAt, snapshot };
  } catch {
    // A partial write or an older format can be skipped independently of the other slot.
    return;
  }
}

function openSlots() {
  return SLOT_NAMES.map((name) => new File(Paths.document, name));
}

export function readPublicGisCache(apiUrl: string): SavedSnapshot | undefined {
  if (Platform.OS === 'web') return;
  try {
    const key = apiBaseUrl(apiUrl).href;
    const newest = openSlots()
      .map(readSlot)
      .filter((slot): slot is Slot => slot?.apiUrl === key)
      .sort((a, b) => b.revision - a.revision)[0];
    if (newest) return { snapshot: newest.snapshot, savedAt: newest.savedAt };
  } catch {
    return;
  }
}

export function savePublicGisCache(apiUrl: string, snapshot: GisSnapshot) {
  if (Platform.OS === 'web') return;
  try {
    const base = apiBaseUrl(apiUrl);
    const [first, second] = openSlots();
    const a = readSlot(first);
    const b = readSlot(second);
    // Preserve the latest complete slot while the other file is being written.
    const target = (a?.revision ?? 0) > (b?.revision ?? 0) ? second : first;
    const featuresByLayer = new Map(
      snapshot.layers.map((layer) => [layer.layerId, [] as GisSnapshot['collection']['features']]),
    );
    for (const feature of snapshot.collection.features) {
      const layer = snapshot.featureLayers.get(feature.id);
      if (!layer || !feature.id.startsWith(`${layer.layerId}/`)) return;
      const features = featuresByLayer.get(layer.layerId);
      if (!features) return;
      features.push({ ...feature, id: feature.id.slice(layer.layerId.length + 1) });
    }
    const record = JSON.stringify({
      version: CACHE_VERSION,
      revision: Math.max(a?.revision ?? 0, b?.revision ?? 0) + 1,
      apiUrl: base.href,
      savedAt: Date.now(),
      layers: snapshot.layers,
      collections: Array.from(featuresByLayer.values(), (features) => ({
        type: 'FeatureCollection',
        features,
      })),
    });
    if (record.length > MAX_BYTES || new TextEncoder().encode(record).length > MAX_BYTES) return;
    target.create({ overwrite: true });
    target.write(record);
  } catch {
    // Storage failures should never prevent browsing a valid live snapshot.
  }
}
