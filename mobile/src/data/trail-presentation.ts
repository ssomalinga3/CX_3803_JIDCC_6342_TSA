import {
  GatewayCasing,
  OtherTrail,
  TrailCasing,
  TrailColors,
  UnnamedConnection,
} from '@/constants/trail-colors';
import type { GisSnapshot } from '@/data/gis';

export type TrailLegendEntry = {
  id: string;
  name: string;
  colorName: string;
  color: string;
  casing: string;
  dashed: boolean;
};

// Derive local render properties without changing the API snapshot or inferring GIS color.
export function trailPresentation(collection: GisSnapshot['collection']) {
  const entries = new Map<string, TrailLegendEntry>();
  const features = collection.features.map((feature) => {
    if (
      !['LineString', 'MultiLineString'].includes(feature.geometry.type) ||
      (feature.properties.feature_kind !== undefined && feature.properties.feature_kind !== 'trail')
    )
      return feature;
    const properties = feature.properties;
    const id = properties.trail_id;
    const unnamed = properties.name_assignment === 'unassigned';
    const known =
      !unnamed &&
      properties.feature_kind === 'trail' &&
      typeof id === 'string' &&
      Object.hasOwn(TrailColors, id);
    const key = known ? id : unnamed ? 'unnamed' : 'other';
    const token = known
      ? TrailColors[id as keyof typeof TrailColors]
      : unnamed
        ? UnnamedConnection
        : OtherTrail;
    const entry = {
      id: key,
      ...token,
      casing: known && id === 'gateway' ? GatewayCasing : TrailCasing,
      dashed: unnamed,
    };
    entries.set(key, entry);
    return {
      ...feature,
      properties: {
        ...properties,
        // Always overwrite these keys; untrusted API values cannot control presentation.
        _display_trail_color: entry.color,
        _display_trail_casing: entry.casing,
        _display_trail_dashed: entry.dashed,
      },
    };
  });
  return {
    collection: { ...collection, features },
    legend: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
