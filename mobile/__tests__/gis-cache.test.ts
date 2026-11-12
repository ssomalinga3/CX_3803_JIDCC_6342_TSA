import { readPublicGisCache, savePublicGisCache } from '@/data/gis-cache';
import { assembleGisSnapshot } from '@/data/gis';

import { collection, layer } from './fixtures/gis';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  return {
    files,
    Paths: { document: 'documents' },
    File: class {
      private name: string;
      constructor(_directory: string, name: string) {
        this.name = name;
      }
      get exists() {
        return files.has(this.name);
      }
      get size() {
        return new TextEncoder().encode(this.textSync()).length;
      }
      textSync() {
        return files.get(this.name) ?? '';
      }
      create() {
        files.set(this.name, '');
      }
      write(content: string) {
        files.set(this.name, content);
      }
    },
  };
});

const { files } = jest.requireMock('expo-file-system') as { files: Map<string, string> };
const api = 'https://example.com/api/v1';
const snapshot = assembleGisSnapshot([layer], [collection]);

beforeEach(() => {
  files.clear();
  globalThis.TextEncoder ??= jest.requireActual('node:util').TextEncoder;
});

test('restores provenance and feature identity only for the matching API', () => {
  savePublicGisCache(api, snapshot);
  expect(readPublicGisCache(api)).toEqual({ snapshot, savedAt: expect.any(Number) });
  expect(readPublicGisCache('https://other.example.com/api/v1')).toBeUndefined();
});

test('retains the last complete snapshot after an interrupted replacement', () => {
  const replacement = assembleGisSnapshot([], []);
  savePublicGisCache(api, snapshot);
  savePublicGisCache(api, replacement);
  expect(readPublicGisCache(api)?.snapshot).toEqual(replacement);

  files.set('public-gis-b.json', '{"version":1,');
  expect(readPublicGisCache(api)?.snapshot).toEqual(snapshot);
});

test('rejects an incomplete cached layer set', () => {
  savePublicGisCache(api, snapshot);
  const file = 'public-gis-a.json';
  const record = JSON.parse(files.get(file)!);
  files.set(file, JSON.stringify({ ...record, collections: [] }));
  expect(readPublicGisCache(api)).toBeUndefined();
});
