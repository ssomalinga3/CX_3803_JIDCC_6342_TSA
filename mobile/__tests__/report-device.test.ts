import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import {
  captureReportLocation,
  createGuestReportIdentity,
  pickReportPhoto,
  readGuestReportSecret,
  removeReportPhoto,
} from '@/data/report-device';

const id = '616d1c6c-3780-4eb2-a45d-1d6781990a90';
const mockFiles = new Map<string, number>();
const mockResize = jest.fn();
const mockRelease = jest.fn();
const mockSave = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(), getRandomBytesAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: mockResize,
      renderAsync: async () => ({ saveAsync: mockSave, release: mockRelease }),
      release: mockRelease,
    }),
  },
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace('cache//', 'cache/');
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri) ?? 0;
    }
    async copy(target: { uri: string }) {
      mockFiles.set(target.uri, this.size);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  jest.mocked(Crypto.randomUUID).mockReturnValue(id);
  jest.mocked(Crypto.getRandomBytesAsync).mockResolvedValue(new Uint8Array(32).fill(1));
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(SecureStore.getItemAsync).mockReset();
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue({ granted: true, canAskAgain: true } as Awaited<
      ReturnType<typeof ImagePicker.getCameraPermissionsAsync>
    >);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///library/original.heic', width: 4000, height: 3000 }],
  } as ImagePicker.ImagePickerResult);
  mockSave.mockImplementation(async () => {
    mockFiles.set('file:///cache/converted.jpg', 1000);
    return { uri: 'file:///cache/converted.jpg', width: 2048, height: 1536 };
  });
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ granted: true, canAskAgain: true } as Awaited<
      ReturnType<typeof Location.getForegroundPermissionsAsync>
    >);
});
test('stores a random per-report 256-bit secret securely and verifies the write before returning', async () => {
  jest
    .mocked(SecureStore.getItemAsync)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce('01'.repeat(32));
  expect(await createGuestReportIdentity()).toEqual({ id, secret: '01'.repeat(32) });
  expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(`report-owner.${id}`, '01'.repeat(32), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
});
test('fails closed if secure storage is unavailable or an existing ownership key is lost', async () => {
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  await expect(createGuestReportIdentity()).rejects.toMatchObject({ code: 'OWNERSHIP' });
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  await expect(readGuestReportSecret(id)).rejects.toMatchObject({ code: 'OWNERSHIP' });
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
test('converts library images to bounded JPEG cache copies without requesting EXIF or deleting the original', async () => {
  const photo = await pickReportPhoto('library');
  expect(photo).toMatchObject({
    uri: `file:///cache/report-${id}.jpg`,
    size: 1000,
    width: 2048,
    height: 1536,
    type: 'image/jpeg',
  });
  expect(mockResize).toHaveBeenCalledWith({ width: 2048 });
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaTypes: ['images'],
      exif: false,
      base64: false,
      allowsEditing: false,
    }),
  );
  expect(new File('file:///cache/converted.jpg').exists).toBe(false);
  await removeReportPhoto(photo!);
  expect(mockFiles.size).toBe(0);
  mockFiles.set('file:///library/original.heic', 1000);
  await removeReportPhoto({ ...photo!, uri: 'file:///library/original.heic' });
  expect(mockFiles.has('file:///library/original.heic')).toBe(true);
});
test('cancellation produces no file and denied camera access never launches a camera', async () => {
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  expect(await pickReportPhoto('library')).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue({ granted: false, canAskAgain: false } as Awaited<
      ReturnType<typeof ImagePicker.getCameraPermissionsAsync>
    >);
  await expect(pickReportPhoto('camera')).rejects.toMatchObject({ code: 'CAMERA_DENIED' });
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
});
test('location denial and disabled services never fabricate coordinates', async () => {
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValueOnce(false);
  expect(await captureReportLocation(new AbortController().signal)).toEqual({
    location: null,
    locationReason: 'unavailable',
  });
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ granted: false, canAskAgain: false } as Awaited<
      ReturnType<typeof Location.getForegroundPermissionsAsync>
    >);
  expect(await captureReportLocation(new AbortController().signal)).toEqual({
    location: null,
    locationReason: 'permission_denied',
  });
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});
test('preserves longitude/latitude and removes a late-created native location subscription', async () => {
  const remove = jest.fn();
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_options, callback) => {
    callback({
      coords: { longitude: -84.4792, latitude: 33.7176, accuracy: 5 },
      timestamp: Date.now(),
    } as Location.LocationObject);
    return { remove };
  });
  const result = await captureReportLocation(new AbortController().signal);
  expect(result).toEqual({ location: { type: 'Point', coordinates: [-84.4792, 33.7176] } });
  await Promise.resolve();
  expect(remove).toHaveBeenCalledTimes(1);
});
test('aborting location lookup removes its subscription and ignores subsequent fixes', async () => {
  const controller = new AbortController();
  const remove = jest.fn();
  jest.mocked(Location.watchPositionAsync).mockImplementation(async () => {
    controller.abort();
    return { remove };
  });
  expect(await captureReportLocation(controller.signal)).toEqual({
    location: null,
    locationReason: 'unavailable',
  });
  await Promise.resolve();
  expect(remove).toHaveBeenCalledTimes(1);
});
