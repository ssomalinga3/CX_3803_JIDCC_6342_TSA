import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  REPORT_LIMITS,
  ReportFailure,
  SUBMISSION_UUID,
  type ReportPhoto,
  type ReportFields,
} from './reporting';

const keyFor = (id: string) => {
  if (!SUBMISSION_UUID.test(id))
    throw new ReportFailure('OWNERSHIP', 'This report cannot be securely submitted.');
  return `report-owner.${id}`;
};
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Persist before uploading; never generate another secret for an existing submission. */
export async function createGuestReportIdentity(): Promise<{ id: string; secret: string }> {
  try {
    if (!(await SecureStore.isAvailableAsync())) throw new Error();
    const id = Crypto.randomUUID();
    const key = keyFor(id);
    if (await SecureStore.getItemAsync(key, secureOptions)) throw new Error();
    const bytes = await Crypto.getRandomBytesAsync(32);
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(key, secret, secureOptions);
    if ((await SecureStore.getItemAsync(key, secureOptions)) !== secret) throw new Error();
    return { id, secret };
  } catch {
    throw new ReportFailure(
      'OWNERSHIP',
      'Secure report storage is unavailable. Nothing was submitted.',
    );
  }
}

export async function readGuestReportSecret(id: string): Promise<string> {
  try {
    const secret = await SecureStore.getItemAsync(keyFor(id), secureOptions);
    if (!secret || !/^[0-9a-f]{64}$/.test(secret)) throw new Error();
    return secret;
  } catch {
    throw new ReportFailure(
      'OWNERSHIP',
      'The ownership key is unavailable. Keep this report for recovery.',
    );
  }
}

/** Remove only our own generated cache copies; never originals in a visitor's library. */
export async function removeReportPhoto(photo: ReportPhoto): Promise<void> {
  try {
    const root = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
    if (
      !photo.uri.startsWith(root) ||
      !/^report-[0-9a-f-]{36}\.jpg$/.test(photo.uri.slice(root.length))
    )
      return;
    const file = new File(photo.uri);
    if (file.exists) await file.delete();
  } catch {
    /* Cache cleanup must not invalidate an accepted receipt. */
  }
}

export async function pickReportPhoto(source: 'camera' | 'library'): Promise<ReportPhoto | null> {
  if (Platform.OS === 'web')
    throw new ReportFailure('DEVICE', 'Use the iOS or Android app to add report photos.');
  try {
    if (source === 'camera') {
      let permission = await ImagePicker.getCameraPermissionsAsync();
      if (!permission.granted && permission.canAskAgain)
        permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted)
        throw new ReportFailure(
          'CAMERA_DENIED',
          'Camera access is off. Choose a photo instead, or enable camera access in Settings.',
        );
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      exif: false,
      base64: false,
    };
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: false });
    if (picked.canceled) return null;
    const asset = picked.assets[0];
    if (
      !asset ||
      !Number.isFinite(asset.width) ||
      !Number.isFinite(asset.height) ||
      Math.min(asset.width, asset.height) < 1 ||
      asset.width * asset.height > 100_000_000 ||
      Math.max(asset.width, asset.height) > 16_384
    )
      throw new ReportFailure('PHOTO', 'This photo cannot be prepared. Choose a different photo.');
    const capturedAt = new Date().toISOString(); // Selection/capture time, never inferred from EXIF.
    const context = ImageManipulator.manipulate(asset.uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      const longest = Math.max(asset.width, asset.height);
      if (longest > 2048)
        context.resize(asset.width >= asset.height ? { width: 2048 } : { height: 2048 });
      rendered = await context.renderAsync();
      for (const compress of [0.85, 0.65, 0.4]) {
        const result = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress,
          base64: false,
        });
        const generated = new File(result.uri);
        let target: File | undefined;
        try {
          if (!generated.exists || generated.size < 1 || generated.size > REPORT_LIMITS.photoBytes)
            continue;
          if (
            Math.max(result.width, result.height) > REPORT_LIMITS.edge ||
            result.width * result.height > REPORT_LIMITS.pixels
          )
            throw new Error();
          target = new File(Paths.cache, `report-${Crypto.randomUUID()}.jpg`);
          await generated.copy(target);
          return {
            uri: target.uri,
            width: result.width,
            height: result.height,
            size: target.size,
            type: 'image/jpeg',
            capturedAt,
          };
        } catch {
          if (target?.exists) await target.delete();
          throw new Error();
        } finally {
          if (generated.exists) await generated.delete();
        }
      }
      throw new ReportFailure('PHOTO', 'This photo is too large. Choose a smaller photo.');
    } finally {
      rendered?.release();
      context.release();
    }
  } catch (error) {
    if (error instanceof ReportFailure) throw error;
    throw new ReportFailure(
      'PHOTO',
      'The photo could not be prepared. Your other details are still here.',
    );
  }
}

export type ReportLocationResult = Pick<ReportFields, 'location' | 'locationReason'>;

/** One foreground subscription, bounded lifetime, no background collection or map-state reuse. */
export async function captureReportLocation(signal: AbortSignal): Promise<ReportLocationResult> {
  const absent = { location: null, locationReason: 'unavailable' } as const;
  try {
    if (signal.aborted || !(await Location.hasServicesEnabledAsync())) return absent;
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && !signal.aborted)
      permission = await Location.requestForegroundPermissionsAsync();
    if (signal.aborted) return absent;
    if (!permission.granted) return { location: null, locationReason: 'permission_denied' };
    return await new Promise<ReportLocationResult>((resolve) => {
      let subscription: Location.LocationSubscription | undefined;
      let finished = false;
      const done = (value: ReportLocationResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        subscription?.remove();
        resolve(value);
      };
      const cancel = () => done(absent);
      const timer = setTimeout(cancel, 15_000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      void Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
        (fix) => {
          const { latitude, longitude, accuracy } = fix.coords;
          const age = Date.now() - fix.timestamp;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180 ||
            !Number.isFinite(age) ||
            age < -5000 ||
            age > 30_000 ||
            (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))
          )
            return;
          done({ location: { type: 'Point', coordinates: [longitude, latitude] } });
        },
        cancel,
      ).then((watcher) => {
        subscription = watcher;
        if (finished) watcher.remove();
      }, cancel);
    });
  } catch {
    return absent;
  }
}
