import type { Bbox } from './types.js';

/** Reject repeated/structured queries, empty values, non-finite and wrapped bounds. */
export function parseBbox(value: unknown): Bbox | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid bbox');
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) {
    throw new Error('Invalid bbox');
  }
  const bounds = parts.map(Number) as Bbox;
  const [west, south, east, north] = bounds;
  if (
    !bounds.every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    throw new Error('Invalid bbox');
  }
  return bounds;
}
