import {
  loadReportOptions,
  normalizeReportRecipient,
  parseReportOptions,
  parseReportReceipt,
  prepareReport,
  reportEndpoint,
  submitReport,
  type ReportFields,
} from '@/data/reporting';

jest.mock('expo-file-system', () => ({
  File: class {
    name = 'prepared.jpg';
    type = 'image/jpeg';
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes() {
      return new Uint8Array([255, 216, 255, 217]);
    }
  },
}));

const id = '616d1c6c-3780-4eb2-a45d-1d6781990a90';
const options = parseReportOptions({
  development: true,
  delivery_modes: ['custom'],
  categories: [
    {
      category_id: 'dev-environmental',
      name: 'Environmental observation (development)',
      pillar: 'Environmental',
    },
  ],
});
const photo = {
  uri: 'file:///cache/report.jpg',
  width: 100,
  height: 200,
  size: 1000,
  type: 'image/jpeg',
  capturedAt: '2026-11-18T12:00:00Z',
} as const;
const fields = (): ReportFields => ({
  categoryId: 'dev-environmental',
  recipients: [' Person@EXAMPLE.test ', 'Person@example.test'],
  note: ' Reviewed note ',
  photos: [{ ...photo }],
  location: null,
  locationReason: 'not_shared',
});
const receipt = {
  client_submission_id: id,
  observation_id: '616d1c6c-3780-4eb2-a45d-1d6781990a91',
  status: 'accepted',
  accepted_at: '2026-11-18T12:01:00Z',
};
const originalFetch = globalThis.fetch;
const originalFormData = globalThis.FormData;
const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
  const native = jest.requireActual('react-native/Libraries/Network/FormData').default;
  const { installFormDataPatch } = jest.requireActual('expo/src/winter/FormData');
  globalThis.FormData = installFormDataPatch(native);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalFormData;
});
const response = (data: unknown, status = 200, retryAfter: string | null = null) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(data),
  headers: { get: () => retryAfter },
});

test('normalizes explicit recipients without changing local case or accepting header injection', () => {
  expect(normalizeReportRecipient(' A+B@EXAMPLE.test ')).toBe('A+B@example.test');
  for (const address of [
    'a@example.test\r\nBcc:b@example.test',
    'Name <a@example.test>',
    'a..b@example.test',
    'a@example.test@',
  ])
    expect(() => normalizeReportRecipient(address)).toThrow('Enter a valid email address.');
});
test('freezes the reviewed payload and preserves consented longitude/latitude and first capture time', () => {
  const input = fields();
  input.location = { type: 'Point', coordinates: [-122.65, 47.12] };
  delete input.locationReason;
  const report = prepareReport(id, input, options);
  expect(report.metadata).toMatchObject({
    client_submission_id: id,
    delivery_mode: 'custom',
    captured_at: photo.capturedAt,
    custom_recipients: ['Person@example.test'],
    note: 'Reviewed note',
    location: { type: 'Point', coordinates: [-122.65, 47.12] },
  });
  input.location.coordinates[0] = 0;
  input.photos[0].uri = 'file:///changed.jpg';
  input.recipients.push('other@example.test');
  expect(report.metadata.location!.coordinates).toEqual([-122.65, 47.12]);
  expect(report.photos[0].uri).toBe(photo.uri);
  expect(Object.isFrozen(report.metadata.custom_recipients)).toBe(true);
});
test.each([
  { categoryId: 'unknown' },
  { recipients: [] },
  { recipients: Array(21).fill('a@example.test') },
  { note: 'x'.repeat(2001) },
  { locationReason: undefined },
  { photos: [] },
  { photos: Array(4).fill(photo) },
  { photos: [{ ...photo, size: 5 * 1024 * 1024 + 1 }] },
  { photos: [{ ...photo, uri: 'https://private.example/photo' }] },
  { photos: [{ ...photo, capturedAt: '2026-02-30T12:00:00Z' }] },
  { photos: [{ ...photo, width: 4097 }] },
])('rejects invalid review input before any upload', (change) => {
  expect(() => prepareReport(id, { ...fields(), ...change }, options)).toThrow();
  expect(mockFetch).not.toHaveBeenCalled();
});
test.each([
  { development: false },
  { delivery_modes: ['park', 'custom'] },
  { categories: [] },
  { categories: [options.categories[0], options.categories[0]] },
])('rejects unexpected option catalogs', (change) => {
  expect(() => parseReportOptions({ ...options, ...change })).toThrow();
});
test('restricts report URLs and keeps credentials out of the URL', () => {
  expect(reportEndpoint('http://10.0.2.2:8787/api/v1/', 'observations', true)).toBe(
    'http://10.0.2.2:8787/api/v1/observations',
  );
  for (const base of [
    'http://example.test/api/v1',
    'https://u:p@example.test/api/v1',
    'https://example.test/api/v1?secret=private',
    'https://example.test/other',
    'https://example.test/api/v1#private',
  ])
    expect(() => reportEndpoint(base, 'observations', true)).toThrow();
  expect(() => reportEndpoint('http://localhost/api/v1', 'observations', false)).toThrow();
});
test('loads runtime-validated custom-only options', async () => {
  mockFetch.mockResolvedValue(response(options));
  const signal = new AbortController().signal;
  expect(await loadReportOptions('https://example.test/api/v1', signal)).toEqual(options);
  expect(mockFetch).toHaveBeenCalledWith(
    'https://example.test/api/v1/report-options',
    expect.objectContaining({ signal, redirect: 'error' }),
  );
});
test('submits immutable metadata and ordered local files without manually setting a multipart boundary', async () => {
  mockFetch.mockResolvedValue(response(receipt, 201));
  const report = prepareReport(id, fields(), options);
  const signal = new AbortController().signal;
  expect(await submitReport('https://example.test/api/v1', report, '1'.repeat(64), signal)).toEqual(
    receipt,
  );
  const [url, request] = mockFetch.mock.calls[0];
  expect(url).toBe('https://example.test/api/v1/observations');
  expect(request).toMatchObject({
    method: 'POST',
    signal,
    redirect: 'error',
    headers: { Authorization: `Bearer ${'1'.repeat(64)}`, Accept: 'application/json' },
  });
  expect(request.headers['Content-Type']).toBeUndefined();
  const parts = [...request.body.entries()];
  expect(JSON.parse(parts[0][1])).toEqual(report.metadata);
  expect(parts[1][0]).toBe('images');
  expect(parts[1][1]).toMatchObject({ uri: photo.uri, name: 'prepared.jpg', type: 'image/jpeg' });
  // Exercise the installed SDK 57 encoder: legacy URI dictionaries pass RN's
  // getParts() tests but fail in the Expo fetch runtime before sending a byte.
  const { convertFormDataAsync } = jest.requireActual('expo/src/winter/fetch/convertFormData');
  const encoded = await convertFormDataAsync(request.body, 'test-report-boundary');
  const payload = new TextDecoder().decode(encoded.body);
  expect(payload).toContain('filename="prepared.jpg"');
  expect(payload).toContain('content-type: image/jpeg');
  expect(payload).not.toContain('file:///cache');
  const legacy = new FormData();
  legacy.append('images', {
    uri: photo.uri,
    name: 'legacy.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  await expect(convertFormDataAsync(legacy)).rejects.toThrow('Unsupported FormDataPart');
});
test.each([
  null,
  { ...receipt, client_submission_id: 'other' },
  { ...receipt, status: 'sent' },
  { ...receipt, accepted_at: 'not a time' },
  { ...receipt, url: 'https://private.example.test/photo' },
])('treats malformed success receipts as uncertain', (invalid) => {
  expect(() => parseReportReceipt(invalid, id)).toThrow('could not be confirmed');
});
test.each([
  [400, false, 0],
  [413, false, 0],
  [415, false, 0],
  [401, true, 0],
  [404, true, 0],
  [503, true, 0],
  [429, true, 5000],
])(
  'classifies status %s without echoing dependency errors',
  async (status, uncertain, retryAfterMs) => {
    mockFetch.mockResolvedValue(
      response(
        { error: { code: 'private coordinates, recipients, URLs and stack' } },
        status as number,
        status === 429 ? '5' : null,
      ),
    );
    await expect(
      submitReport(
        'https://example.test/api/v1',
        prepareReport(id, fields(), options),
        '1'.repeat(64),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ uncertain, retryAfterMs });
  },
);
test('honors in-progress retry delay and does not surface raw transport failures', async () => {
  const report = prepareReport(id, fields(), options);
  mockFetch
    .mockResolvedValueOnce(response({ error: { code: 'SUBMISSION_IN_PROGRESS' } }, 409, '7'))
    .mockRejectedValueOnce(new Error('private secret / coordinates / file URL'));
  await expect(
    submitReport(
      'https://example.test/api/v1',
      report,
      '1'.repeat(64),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'IN_PROGRESS', uncertain: true, retryAfterMs: 7000 });
  await expect(
    submitReport(
      'https://example.test/api/v1',
      report,
      '1'.repeat(64),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({
    code: 'CONNECTION',
    uncertain: true,
    message: 'Submission could not be confirmed. Keep this report and retry.',
  });
});
