import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  randomUUID,
} from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  parseReportOptions,
  parseReportReceipt,
  prepareReport,
  ReportFailure,
  SUBMISSION_UUID,
  type PreparedReport,
  type ReportFields,
  type ReportOptions,
  type ReportReceipt,
} from './reporting';

export type SavedReportDraft = {
  apiUrl: string;
  fields: ReportFields;
  options?: ReportOptions;
  identity?: string;
  prepared?: PreparedReport;
  attempted: boolean;
  receipt?: ReportReceipt;
  retryAt: number;
  retryable?: boolean;
};
type Envelope = {
  version: 1;
  generation: number;
  draft: SavedReportDraft;
  photoBytes: string[];
};
const KEY = 'report-draft-encryption.v1';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const LIMIT = 22 * 1024 * 1024;
let queue: Promise<unknown> = Promise.resolve();
const folder = () => new Directory(Paths.document, 'private-report-draft-v1');
const TEMPORARY_PHOTO = /^report-[0-9a-f-]{36}\.jpg$/;

/**
 * Restored photos are written as new plaintext cache copies. Remove copies left by an
 * earlier process before materializing this generation, so a restart or force-quit
 * cannot leave decrypted report photos behind after acceptance or deletion.
 */
function removeStalePhotoCopies() {
  for (const entry of new Directory(Paths.cache).list()) {
    if (entry instanceof File && TEMPORARY_PHOTO.test(entry.name)) entry.delete();
  }
}
const slots = () => [new File(folder(), 'a.bin'), new File(folder(), 'b.bin')];

function storageFailure(): ReportFailure {
  return new ReportFailure(
    'STORAGE',
    'Your report could not be saved or recovered. Keep the app open and retry, or explicitly discard the draft.',
  );
}
async function encryptionKey(create: boolean) {
  let encoded = await SecureStore.getItemAsync(KEY, secureOptions);
  if (!encoded) {
    if (!create) throw storageFailure();
    const key = await AESEncryptionKey.generate();
    encoded = await key.encoded('hex');
    await SecureStore.setItemAsync(KEY, encoded, secureOptions);
    if ((await SecureStore.getItemAsync(KEY, secureOptions)) !== encoded) throw storageFailure();
  }
  return AESEncryptionKey.import(encoded, 'hex');
}
async function readEnvelopes(key: AESEncryptionKey) {
  const entries: { file: File; envelope: Envelope }[] = [];
  for (const file of slots()) {
    if (!file.exists) continue;
    try {
      if (file.size > LIMIT + 32) continue;
      const plaintext = await aesDecryptAsync(AESSealedData.fromCombined(await file.bytes()), key);
      const value: Envelope = JSON.parse(new TextDecoder().decode(plaintext));
      if (
        value.version !== 1 ||
        !Number.isSafeInteger(value.generation) ||
        !value.draft ||
        !Array.isArray(value.photoBytes) ||
        value.photoBytes.length > 3
      )
        continue;
      entries.push({ file, envelope: value });
    } catch {
      // An interrupted replacement can leave one invalid slot. Preserve the other copy.
    }
  }
  return entries.sort((a, b) => b.envelope.generation - a.envelope.generation);
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation, operation);
  queue = task.catch(() => {});
  return task;
}

export function saveReportDraft(draft: SavedReportDraft): Promise<void> {
  return serialized(async () => {
    try {
      folder().create({ idempotent: true, intermediates: true });
      const existing = slots().some((file) => file.exists);
      const key = await encryptionKey(!existing);
      const entries = await readEnvelopes(key);
      if (existing && !entries.length) throw storageFailure();
      const photoBytes = await Promise.all(
        draft.fields.photos.map(async (photo) => {
          const file = new File(photo.uri);
          if (!file.exists || file.size !== photo.size || file.size > 5 * 1024 * 1024)
            throw storageFailure();
          return file.base64();
        }),
      );
      const envelope: Envelope = {
        version: 1,
        generation: Math.max(Date.now(), (entries[0]?.envelope.generation ?? 0) + 1),
        draft,
        photoBytes,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      if (bytes.length > LIMIT) throw storageFailure();
      const sealed = await aesEncryptAsync(bytes, key);
      const target = slots().find((file) => file.uri !== entries[0]?.file.uri)!;
      const temporary = new File(folder(), 'next.bin');
      if (temporary.exists) temporary.delete();
      temporary.write(await sealed.combined());
      // Read back authenticated bytes before publishing this generation.
      await aesDecryptAsync(AESSealedData.fromCombined(await temporary.bytes()), key);
      if (target.exists) target.delete();
      temporary.move(target);
      if (draft.receipt) {
        for (const file of slots()) {
          if (file.uri !== target.uri && file.exists) file.delete();
        }
      }
      if (draft.attempted && draft.identity) {
        const marker = `report-attempted.${draft.identity}`;
        await SecureStore.setItemAsync(marker, 'true', secureOptions);
        if ((await SecureStore.getItemAsync(marker, secureOptions)) !== 'true')
          throw storageFailure();
      }
    } catch {
      throw storageFailure();
    }
  });
}

export function restoreReportDraft(apiUrl: string): Promise<SavedReportDraft | undefined> {
  return serialized(async () => {
    try {
      removeStalePhotoCopies();
    } catch {
      // Cache cleanup must not block recovery of the encrypted draft.
    }
    if (!slots().some((file) => file.exists)) return;
    try {
      const key = await encryptionKey(false);
      const [latest] = await readEnvelopes(key);
      if (!latest) throw storageFailure();
      const { draft, photoBytes } = latest.envelope;
      if (draft.apiUrl !== apiUrl)
        throw new ReportFailure(
          'CONFIGURATION',
          'This saved report belongs to another server. Restore its connection or discard it explicitly.',
        );
      if (draft.identity && !SUBMISSION_UUID.test(draft.identity)) throw storageFailure();
      if (draft.options) draft.options = parseReportOptions(draft.options);
      if (draft.fields.photos.length !== photoBytes.length) throw storageFailure();
      draft.fields.photos = draft.fields.photos.map((photo, index) => {
        const file = new File(Paths.cache, `report-${randomUUID()}.jpg`);
        file.write(photoBytes[index], { encoding: 'base64' });
        if (file.size !== photo.size) throw storageFailure();
        return { ...photo, uri: file.uri };
      });
      if (draft.prepared) {
        if (!draft.options || !draft.identity) throw storageFailure();
        const prepared = prepareReport(draft.identity, draft.fields, draft.options);
        if (JSON.stringify(prepared.metadata) !== JSON.stringify(draft.prepared.metadata))
          throw storageFailure();
        draft.prepared = prepared;
      }
      if (
        draft.identity &&
        (await SecureStore.getItemAsync(`report-attempted.${draft.identity}`, secureOptions)) ===
          'true'
      )
        draft.attempted = true;
      if (draft.attempted && !draft.prepared && !draft.receipt) throw storageFailure();
      if (draft.receipt) {
        if (!draft.identity) throw storageFailure();
        draft.receipt = parseReportReceipt(draft.receipt, draft.identity);
      }
      return draft;
    } catch (error) {
      if (error instanceof ReportFailure) throw error;
      throw storageFailure();
    }
  });
}

export function clearReportDraft(): Promise<void> {
  return serialized(async () => {
    // Only this module's private snapshot directory is removed.
    if (folder().exists) folder().delete();
  });
}
