import type { CustomReportMetadata } from '../../../backend/src/modules/reports/report-contract';
import { File } from 'expo-file-system';

export type ReportCategory = { category_id: string; name: string; pillar: string };
export type ReportOptions = {
  development: true;
  delivery_modes: ['custom'];
  categories: ReportCategory[];
};
export type ReportPhoto = {
  uri: string;
  width: number;
  height: number;
  size: number;
  type: 'image/jpeg';
  capturedAt: string;
};
export type ReportReceipt = {
  observation_id: string;
  client_submission_id: string;
  status: 'accepted';
  accepted_at: string;
};
export type ReportFields = {
  categoryId: string;
  recipients: string[];
  note: string;
  photos: ReportPhoto[];
  location: CustomReportMetadata['location'];
  locationReason?: CustomReportMetadata['location_unavailable_reason'];
};
export type PreparedReport = { metadata: CustomReportMetadata; photos: readonly ReportPhoto[] };
export const REPORT_LIMITS = {
  count: 3,
  photoBytes: 5 * 1024 * 1024,
  edge: 4096,
  pixels: 12_000_000,
  recipients: 20,
  note: 2000,
} as const;
export const SUBMISSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ReportFailure extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly uncertain = false,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'ReportFailure';
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function reportEndpoint(
  apiUrl: string,
  resource: 'report-options' | 'observations',
  allowHttp = __DEV__,
) {
  try {
    const url = new URL(apiUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v1' ||
      !(
        url.protocol === 'https:' ||
        (allowHttp &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname))
      )
    )
      throw new Error();
    return `${url.origin}/api/v1/${resource}`;
  } catch {
    throw new ReportFailure('CONFIGURATION', 'Reporting is not available on this connection.');
  }
}

export function parseReportOptions(value: unknown): ReportOptions {
  if (
    !object(value) ||
    value.development !== true ||
    !Array.isArray(value.delivery_modes) ||
    value.delivery_modes.length !== 1 ||
    value.delivery_modes[0] !== 'custom' ||
    !Array.isArray(value.categories) ||
    value.categories.length < 1 ||
    value.categories.length > 32
  )
    throw new ReportFailure('OPTIONS', 'Reporting options are unavailable. Try again.');
  const ids = new Set<string>();
  const categories = value.categories.map((category) => {
    if (
      !object(category) ||
      typeof category.category_id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(category.category_id) ||
      ids.has(category.category_id) ||
      typeof category.name !== 'string' ||
      !category.name.trim() ||
      category.name.length > 120 ||
      typeof category.pillar !== 'string' ||
      !['Human', 'Social', 'Environmental', 'Economic'].includes(category.pillar)
    )
      throw new ReportFailure('OPTIONS', 'Reporting options are unavailable. Try again.');
    ids.add(category.category_id);
    return { category_id: category.category_id, name: category.name, pillar: category.pillar };
  });
  return { development: true, delivery_modes: ['custom'], categories };
}

export function normalizeReportRecipient(value: string): string {
  const email = value.trim();
  const [local, domain, extra] = email.split('@');
  if (
    email.length > 254 ||
    /[^\x21-\x7e]/.test(email) ||
    extra !== undefined ||
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    !domain ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)
  )
    throw new ReportFailure('RECIPIENT', 'Enter a valid email address.');
  return `${local}@${domain.toLowerCase()}`;
}

export function prepareReport(
  id: string,
  fields: ReportFields,
  options: ReportOptions,
): PreparedReport {
  if (
    !SUBMISSION_UUID.test(id) ||
    !options.categories.some((c) => c.category_id === fields.categoryId)
  )
    throw new ReportFailure('CATEGORY', 'Choose an available category.');
  if (fields.photos.length < 1 || fields.photos.length > REPORT_LIMITS.count)
    throw new ReportFailure('PHOTOS', 'Add between one and three photos.');
  for (const photo of fields.photos) {
    if (
      !/^file:\/\//.test(photo.uri) ||
      photo.type !== 'image/jpeg' ||
      !Number.isInteger(photo.size) ||
      photo.size < 1 ||
      photo.size > REPORT_LIMITS.photoBytes ||
      !Number.isInteger(photo.width) ||
      !Number.isInteger(photo.height) ||
      Math.min(photo.width, photo.height) < 1 ||
      Math.max(photo.width, photo.height) > REPORT_LIMITS.edge ||
      photo.width * photo.height > REPORT_LIMITS.pixels ||
      !validTime(photo.capturedAt)
    )
      throw new ReportFailure('PHOTOS', 'Replace the unsupported or oversized photo.');
  }
  if (fields.recipients.length < 1 || fields.recipients.length > REPORT_LIMITS.recipients)
    throw new ReportFailure('RECIPIENT', 'Add between one and twenty email addresses.');
  const recipients = [...new Set(fields.recipients.map(normalizeReportRecipient))].sort();
  if (fields.note.length > REPORT_LIMITS.note || fields.note.includes('\0'))
    throw new ReportFailure('NOTE', 'Keep the note under 2,001 characters.');
  const point = fields.location;
  if (point) {
    if (
      point.type !== 'Point' ||
      point.coordinates.length !== 2 ||
      !point.coordinates.every(Number.isFinite) ||
      Math.abs(point.coordinates[0]) > 180 ||
      Math.abs(point.coordinates[1]) > 90 ||
      fields.locationReason !== undefined
    )
      throw new ReportFailure('LOCATION', 'Review the location before continuing.');
  } else if (
    !fields.locationReason ||
    !['not_shared', 'permission_denied', 'unavailable'].includes(fields.locationReason)
  )
    throw new ReportFailure('LOCATION', 'Choose whether to include your location.');
  const metadata: CustomReportMetadata = {
    client_submission_id: id,
    category_id: fields.categoryId,
    captured_at: fields.photos[0].capturedAt,
    location: point ? { type: 'Point', coordinates: [...point.coordinates] } : null,
    ...(point ? {} : { location_unavailable_reason: fields.locationReason }),
    delivery_mode: 'custom',
    custom_recipients: recipients,
    ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
  };
  // Detach nested input objects so edits cannot mutate a reviewed/retryable request.
  const result: PreparedReport = {
    metadata,
    photos: fields.photos.map((photo) => Object.freeze({ ...photo })),
  };
  if (metadata.location) {
    Object.freeze(metadata.location.coordinates);
    Object.freeze(metadata.location);
  }
  Object.freeze(metadata.custom_recipients);
  Object.freeze(metadata);
  Object.freeze(result.photos);
  return Object.freeze(result);
}

function validTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
export function parseReportReceipt(value: unknown, expectedId: string): ReportReceipt {
  if (
    !object(value) ||
    Object.keys(value).sort().join(',') !==
      'accepted_at,client_submission_id,observation_id,status' ||
    value.client_submission_id !== expectedId ||
    typeof value.observation_id !== 'string' ||
    !SUBMISSION_UUID.test(value.observation_id) ||
    value.status !== 'accepted' ||
    !validTime(value.accepted_at)
  )
    throw new ReportFailure(
      'RECEIPT',
      'The result could not be confirmed. Retry this same report.',
      true,
    );
  return value as ReportReceipt;
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 64 * 1024) throw new Error();
  return JSON.parse(text);
}
export async function loadReportOptions(
  apiUrl: string,
  signal: AbortSignal,
): Promise<ReportOptions> {
  const endpoint = reportEndpoint(apiUrl, 'report-options');
  try {
    const response = await fetch(endpoint, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error();
    return parseReportOptions(await boundedJson(response));
  } catch {
    throw new ReportFailure('OPTIONS', 'Reporting options are unavailable. Try again.');
  }
}

export async function submitReport(
  apiUrl: string,
  report: PreparedReport,
  secret: string,
  signal: AbortSignal,
): Promise<ReportReceipt> {
  const endpoint = reportEndpoint(apiUrl, 'observations');
  if (!/^[0-9a-f]{64}$/.test(secret))
    throw new ReportFailure('OWNERSHIP', 'This report cannot be securely submitted.');
  // SDK 57 installs expo/fetch globally. Its multipart encoder accepts File/Blob
  // objects with bytes(), not the legacy React Native { uri, name, type } shape.
  const form = new FormData();
  form.append('metadata', JSON.stringify(report.metadata));
  report.photos.forEach((photo) => form.append('images', new File(photo.uri)));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      body: form,
    });
  } catch {
    throw new ReportFailure(
      'CONNECTION',
      'Submission could not be confirmed. Keep this report and retry.',
      true,
    );
  }
  if (response.status === 200 || response.status === 201) {
    try {
      return parseReportReceipt(await boundedJson(response), report.metadata.client_submission_id);
    } catch {
      throw new ReportFailure(
        'RECEIPT',
        'The result could not be confirmed. Retry this same report.',
        true,
      );
    }
  }
  const retryAfter = response.headers.get('Retry-After');
  const seconds =
    retryAfter && /^\d{1,4}$/.test(retryAfter) ? Math.min(Number(retryAfter), 600) : 0;
  if (response.status === 409) {
    let code: unknown;
    try {
      const value = await boundedJson(response);
      code = object(value) && object(value.error) ? value.error.code : undefined;
    } catch {
      /* Never surface server response text. */
    }
    if (code === 'SUBMISSION_IN_PROGRESS' || code === 'SUBMISSION_LEASE_EXPIRED')
      throw new ReportFailure(
        'IN_PROGRESS',
        'This report is still processing. Wait, then retry.',
        true,
        Math.max(seconds * 1000, 1000),
      );
    throw new ReportFailure(
      'CONFLICT',
      'This report needs attention. Keep it and resolve its earlier submission.',
      true,
    );
  }
  if (response.status === 429 || response.status >= 500)
    throw new ReportFailure(
      'TEMPORARY',
      'The service is unavailable. Keep this report and retry.',
      true,
      seconds * 1000,
    );
  if ([400, 413, 415].includes(response.status))
    throw new ReportFailure(
      'REJECTED',
      'The report was not accepted. Review its category, recipients and photos.',
    );
  // Authentication or unexpected responses may need investigation, never silently replace identity.
  throw new ReportFailure(
    'UNCONFIRMED',
    'This report could not be confirmed. Keep it for retry.',
    true,
  );
}
