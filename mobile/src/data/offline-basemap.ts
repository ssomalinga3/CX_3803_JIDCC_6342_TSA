import {
  OfflineManager,
  type OfflinePack,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';

export { OFFLINE_STYLE, offlineStyleUrl } from '@/data/offline-basemap-config';

const REGION = {
  bounds: [-84.497, 33.702, -84.463, 33.734] as [number, number, number, number],
  minZoom: 13,
  maxZoom: 16,
};
const REGION_ID = 'cascade-springs-v1';

async function findPack(style: string) {
  const packs = await OfflineManager.getPacks();
  return packs.find(({ metadata }) => metadata.region === REGION_ID && metadata.mapStyle === style);
}

export async function basemapStatus(style: string): Promise<OfflinePackStatus | undefined> {
  return (await findPack(style))?.status();
}

function onError(pack: OfflinePack) {
  // A later explicit tap resumes this pack. Keep completed resources.
  void pack
    .pause()
    .catch(() => {})
    .finally(() => OfflineManager.removeListener(pack.id));
}

let starting: Promise<OfflinePackStatus> | undefined;

export function downloadBasemap(style: string): Promise<OfflinePackStatus> {
  starting ??= start(style).finally(() => {
    starting = undefined;
  });
  return starting;
}

async function start(style: string): Promise<OfflinePackStatus> {
  const existing = await findPack(style);
  if (existing) {
    const status = await existing.status();
    if (status.state === 'complete' || status.state === 'active') return status;
    await OfflineManager.addListener(existing.id, () => {}, onError);
    try {
      await existing.resume();
    } catch (error) {
      OfflineManager.removeListener(existing.id);
      throw error;
    }
    return existing.status();
  }
  const pack = await OfflineManager.createPack(
    { ...REGION, mapStyle: style, metadata: { region: REGION_ID, mapStyle: style } },
    () => {},
    onError,
  );
  return pack.status();
}

export async function removeBasemap(style: string): Promise<void> {
  const pack = await findPack(style);
  if (pack) {
    await OfflineManager.deletePack(pack.id);
    OfflineManager.removeListener(pack.id);
  }
}
