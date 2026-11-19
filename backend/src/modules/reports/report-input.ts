import { PHOTO_KEY } from './photo-storage.js';

export class ReportError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = 'ReportError';
  }
}

export const DEVELOPMENT_REPORT_CATEGORIES = [
  { category_id: 'dev-human', name: 'Human observation (development)', pillar: 'Human' },
  { category_id: 'dev-social', name: 'Social observation (development)', pillar: 'Social' },
  {
    category_id: 'dev-environmental',
    name: 'Environmental observation (development)',
    pillar: 'Environmental',
  },
  { category_id: 'dev-economic', name: 'Economic observation (development)', pillar: 'Economic' },
] as const;

export type CustomReportMetadata = {
  client_submission_id: string;
  category_id: string;
  captured_at: string;
  location: { type: 'Point'; coordinates: [number, number] } | null;
  location_unavailable_reason?: 'permission_denied' | 'unavailable' | 'not_shared';
  delivery_mode: 'custom';
  custom_recipients: string[];
  note?: string;
};

function invalid(field: string, message: string): never {
  throw new ReportError('INVALID_REPORT', 400, { [field]: message });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bounded initial mailbox syntax. No display names, quoted locals or header injection. */
export function normalizedRecipient(value: unknown): string {
  if (typeof value !== 'string')
    invalid('custom_recipients', 'Enter valid recipient email addresses.');
  const email = value.trim();
  if (email.length > 254 || /[^\x21-\x7e]/.test(email))
    invalid('custom_recipients', 'Enter valid recipient email addresses.');
  const parts = email.split('@');
  const local = parts[0],
    domain = parts[1];
  if (
    parts.length !== 2 ||
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    !domain ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)
  ) {
    invalid('custom_recipients', 'Enter valid recipient email addresses.');
  }
  return `${local}@${domain.toLowerCase()}`;
}

/** Normalize request shape independently of the current catalog so accepted replays survive catalog changes. */
export function reportMetadata(value: unknown): CustomReportMetadata {
  if (!object(value)) invalid('metadata', 'Provide report metadata.');
  const allowed = new Set([
    'client_submission_id',
    'category_id',
    'captured_at',
    'location',
    'location_unavailable_reason',
    'delivery_mode',
    'custom_recipients',
    'note',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    invalid('metadata', 'Remove unsupported report fields.');
  if (
    typeof value.client_submission_id !== 'string' ||
    !PHOTO_KEY.test(value.client_submission_id.toLowerCase())
  ) {
    invalid('client_submission_id', 'Provide a submission UUID.');
  }
  if (
    typeof value.category_id !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.category_id)
  ) {
    invalid('category_id', 'Choose a report category.');
  }
  if (
    typeof value.captured_at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.captured_at) ||
    !Number.isFinite(Date.parse(value.captured_at))
  )
    invalid('captured_at', 'Provide a UTC capture time.');
  const capturedAt = new Date(value.captured_at).toISOString();
  if (capturedAt.slice(0, 19) !== value.captured_at.slice(0, 19))
    invalid('captured_at', 'Provide a valid capture time.');
  if (value.delivery_mode !== 'custom')
    invalid('delivery_mode', 'Only custom-recipient reporting is enabled.');
  if (
    !Array.isArray(value.custom_recipients) ||
    value.custom_recipients.length < 1 ||
    value.custom_recipients.length > 20
  ) {
    invalid('custom_recipients', 'Choose between 1 and 20 recipient addresses.');
  }
  const recipients = [...new Set(value.custom_recipients.map(normalizedRecipient))].sort();
  let location: CustomReportMetadata['location'],
    reason: CustomReportMetadata['location_unavailable_reason'];
  if (value.location === null) {
    if (
      !['permission_denied', 'unavailable', 'not_shared'].includes(
        String(value.location_unavailable_reason),
      )
    ) {
      invalid('location_unavailable_reason', 'Explain why location is absent.');
    }
    location = null;
    reason = value.location_unavailable_reason as typeof reason;
  } else {
    const point = value.location;
    if (
      !object(point) ||
      point.type !== 'Point' ||
      Object.keys(point).some((key) => !['type', 'coordinates'].includes(key)) ||
      !Array.isArray(point.coordinates) ||
      point.coordinates.length !== 2 ||
      point.coordinates.some(
        (coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate),
      ) ||
      Math.abs(point.coordinates[0]) > 180 ||
      Math.abs(point.coordinates[1]) > 90 ||
      value.location_unavailable_reason !== undefined
    ) {
      invalid('location', 'Provide a valid location or an explicit missing-location reason.');
    }
    location = { type: 'Point', coordinates: [point.coordinates[0], point.coordinates[1]] };
  }
  if (
    value.note !== undefined &&
    (typeof value.note !== 'string' || value.note.length > 2000 || value.note.includes('\0'))
  ) {
    invalid('note', 'Use a note of at most 2000 characters.');
  }
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  return {
    client_submission_id: value.client_submission_id.toLowerCase(),
    category_id: value.category_id,
    captured_at: capturedAt,
    location,
    ...(reason ? { location_unavailable_reason: reason } : {}),
    delivery_mode: 'custom',
    custom_recipients: recipients,
    ...(note ? { note } : {}),
  };
}
