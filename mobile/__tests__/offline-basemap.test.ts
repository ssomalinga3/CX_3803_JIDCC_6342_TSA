import {
  OfflineManager,
  type OfflinePack,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';

import {
  basemapStatus,
  downloadBasemap,
  offlineStyleUrl,
  removeBasemap,
} from '@/data/offline-basemap';

jest.mock('@maplibre/maplibre-react-native', () => ({
  OfflineManager: {
    getPacks: jest.fn(),
    createPack: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    deletePack: jest.fn(),
  },
}));

const style = 'https://maps.example.test/preserve.json';
const manager = jest.mocked(OfflineManager);
const state = (value: OfflinePackStatus['state']) => ({
  id: 'saved',
  state: value,
  percentage: 0,
  completedResourceCount: 0,
  completedResourceSize: 0,
  completedTileCount: 0,
  completedTileSize: 0,
  requiredResourceCount: 0,
});

function pack(value: OfflinePackStatus['state'], mapStyle = style): OfflinePack {
  return {
    id: 'saved',
    bounds: [-84.497, 33.702, -84.463, 33.734],
    metadata: { region: 'cascade-springs-v1', mapStyle },
    status: jest.fn().mockResolvedValue(state(value)),
    resume: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  manager.getPacks.mockResolvedValue([]);
});

it('enables downloads only for explicitly configured HTTPS styles without embedded credentials', () => {
  expect(offlineStyleUrl(style)).toBe(style);
  for (const invalid of [
    undefined,
    'not a URL',
    'http://maps.example.test/style.json',
    'https://tiles.openfreemap.org/styles/liberty',
    'https://maps.example.test/style.json?token=test',
    'https://user:secret@maps.example.test/style.json',
  ]) {
    expect(offlineStyleUrl(invalid)).toBeUndefined();
  }
});

it('starts a single bounded pack for concurrent download requests', async () => {
  manager.createPack.mockResolvedValue(pack('active'));
  const statuses = await Promise.all([downloadBasemap(style), downloadBasemap(style)]);
  expect(statuses).toEqual([state('active'), state('active')]);
  expect(manager.createPack).toHaveBeenCalledTimes(1);
  expect(manager.createPack).toHaveBeenCalledWith(
    expect.objectContaining({
      mapStyle: style,
      bounds: [-84.497, 33.702, -84.463, 33.734],
      minZoom: 13,
      maxZoom: 16,
    }),
    expect.any(Function),
    expect.any(Function),
  );
});

it('recognizes an already downloaded pack and ignores packs from other styles', async () => {
  manager.getPacks.mockResolvedValue([
    pack('active', 'https://other.example.test/style'),
    pack('complete'),
  ]);
  await expect(basemapStatus(style)).resolves.toEqual(state('complete'));
  await expect(downloadBasemap(style)).resolves.toEqual(state('complete'));
  expect(manager.createPack).not.toHaveBeenCalled();
  await removeBasemap(style);
  expect(manager.deletePack).toHaveBeenCalledWith('saved');
});

it('resumes an interrupted download in the original pack', async () => {
  const existing = pack('inactive');
  manager.getPacks.mockResolvedValue([existing]);
  jest
    .mocked(existing.status)
    .mockResolvedValueOnce(state('inactive'))
    .mockResolvedValueOnce(state('active'));
  await expect(downloadBasemap(style)).resolves.toEqual(state('active'));
  expect(existing.resume).toHaveBeenCalledTimes(1);
  expect(manager.createPack).not.toHaveBeenCalled();
});
