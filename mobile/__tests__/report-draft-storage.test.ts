import {
  clearReportDraft,
  restoreReportDraft,
  saveReportDraft,
  type SavedReportDraft,
} from '@/data/report-draft-storage';
const { Buffer } = jest.requireActual('node:buffer');

jest.mock('expo-file-system', () => {
  const { Buffer } = jest.requireActual('node:buffer');
  const files = new Map<string, Uint8Array>();
  class Directory {
    uri = 'file:///documents/private-report-draft-v1';
    exists = true;
    create() {}
    delete() {
      for (const key of files.keys()) if (key.startsWith(this.uri)) files.delete(key);
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      if (!this.exists) throw Error();
      return files.get(this.uri)!;
    }
    async base64() {
      return Buffer.from(await this.bytes()).toString('base64');
    }
    write(value: string | Uint8Array, options?: { encoding: 'base64' }) {
      files.set(
        this.uri,
        typeof value === 'string' ? Buffer.from(value, options?.encoding) : Buffer.from(value),
      );
    }
    delete() {
      files.delete(this.uri);
    }
    move(target: File) {
      files.set(target.uri, files.get(this.uri)!);
      this.delete();
    }
  }
  return {
    File,
    Directory,
    Paths: { document: 'file:///documents', cache: 'file:///cache' },
    files,
  };
});
jest.mock('expo-secure-store', () => {
  const values = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
    getItemAsync: jest.fn(async (key) => values.get(key)),
    setItemAsync: jest.fn(async (key, value) => {
      values.set(key, value);
    }),
    values,
  };
});
jest.mock('expo-crypto', () => {
  const { Buffer } = jest.requireActual('node:buffer');
  const crypto = jest.requireActual('node:crypto');
  return {
    randomUUID: () => crypto.randomUUID(),
    AESEncryptionKey: {
      generate: async () => ({ encoded: async () => crypto.randomBytes(32).toString('hex') }),
      import: async (key: string) => Buffer.from(key, 'hex'),
    },
    AESSealedData: { fromCombined: (bytes: Uint8Array) => bytes },
    aesEncryptAsync: async (bytes: Uint8Array, key: Uint8Array) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        iv,
        cipher.update(bytes),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return { combined: async () => encrypted };
    },
    aesDecryptAsync: async (bytes: Uint8Array, key: Uint8Array) => {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]);
    },
  };
});

const { files } = jest.requireMock('expo-file-system');
const { values } = jest.requireMock('expo-secure-store');
const draft = (note = 'private note'): SavedReportDraft => ({
  apiUrl: 'https://api.example.test/api/v1',
  fields: {
    categoryId: '',
    recipients: [],
    note,
    photos: [],
    location: null,
    locationReason: 'not_shared',
  },
  attempted: false,
  retryAt: 0,
});
beforeEach(() => {
  files.clear();
  values.clear();
});

test('recovers encrypted metadata and photos after temporary cache files are lost', async () => {
  files.set('file:///cache/report-original.jpg', Buffer.from('image bytes'));
  const input = draft();
  input.fields.photos = [
    {
      uri: 'file:///cache/report-original.jpg',
      width: 10,
      height: 10,
      size: 11,
      type: 'image/jpeg',
      capturedAt: '2026-11-19T12:00:00Z',
    },
  ];
  await saveReportDraft(input);
  files.delete('file:///cache/report-original.jpg');
  const restored = await restoreReportDraft(input.apiUrl);
  expect(restored?.fields.note).toBe('private note');
  expect(restored?.fields.photos[0].uri).not.toBe('file:///cache/report-original.jpg');
  expect(files.get(restored!.fields.photos[0].uri).toString()).toBe('image bytes');
  for (const [path, bytes] of files) {
    if (path.includes('/documents/')) expect(bytes.toString()).not.toContain('private note');
  }
});

test('recovers the previous complete snapshot after an interrupted replacement', async () => {
  await saveReportDraft(draft('previous'));
  await saveReportDraft(draft('latest'));
  const slot = [...files.keys()].find((path: string) => path.endsWith('b.bin'));
  files.set(slot, Buffer.from('interrupted write'));
  const restored = await restoreReportDraft(draft().apiUrl);
  expect(restored?.fields.note).toBe('previous');
});

test('retains inaccessible data when its key or server context is unavailable', async () => {
  await saveReportDraft(draft());
  await expect(restoreReportDraft('https://other.example.test/api/v1')).rejects.toMatchObject({
    code: 'CONFIGURATION',
  });
  values.clear();
  await expect(restoreReportDraft(draft().apiUrl)).rejects.toMatchObject({ code: 'STORAGE' });
  expect(files.size).toBeGreaterThan(0);
  await clearReportDraft();
  expect(files.size).toBe(0);
});

test('keeps a durable receipt and removes previous private snapshots after acceptance', async () => {
  await saveReportDraft(draft('pending private note'));
  const accepted = draft('');
  accepted.identity = '616d1c6c-3780-4eb2-a45d-1d6781990a90';
  accepted.attempted = true;
  accepted.receipt = {
    client_submission_id: accepted.identity,
    observation_id: '616d1c6c-3780-4eb2-a45d-1d6781990a91',
    status: 'accepted',
    accepted_at: '2026-11-19T12:00:00Z',
  };
  await saveReportDraft(accepted);
  expect([...files.keys()].filter((path: string) => path.endsWith('.bin'))).toHaveLength(1);
  const restored = await restoreReportDraft(accepted.apiUrl);
  expect(restored?.receipt).toEqual(accepted.receipt);
  expect(restored?.fields.photos).toEqual([]);
  expect(restored?.fields.note).toBe('');
});
