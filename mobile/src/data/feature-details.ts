import type { GisSnapshot } from '@/data/gis';

type GisFeature = GisSnapshot['collection']['features'][number];
export type FeatureDetails = {
  title: string;
  description: string;
  fields: { label: string; value: string }[];
};

// Text extraction only: this result is rendered in native Text, never HTML/WebView.
// Source images, links and scripts are not loaded or executed.
export function featureText(value: unknown, limit = 4000): string {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, 20000)
    .replace(/<!--[^]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (entity) => {
      const entities: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' ',
      };
      return entities[entity.toLowerCase()];
    })
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_entity, code: string) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function priority(feature: GisFeature): number {
  const type = feature.geometry.type;
  if (type.includes('Point')) return 0;
  if (type.includes('Line') || feature.properties.feature_kind === 'trail') return 1;
  // Specific context footprints should be selectable inside large preserve/natural areas.
  const kind = feature.properties.feature_kind;
  return kind === 'boundary' ? 4 : kind === 'natural_area' ? 3 : 2;
}

// Resolve only IDs from the native hit-test; all displayed data comes from the
// current validated snapshot, not native/render-only properties or basemap hits.
export function pressedFeatureId(snapshot: GisSnapshot, hits: unknown): string | undefined {
  if (!Array.isArray(hits)) return;
  const ids = new Set(
    hits.flatMap((hit: unknown) =>
      hit && typeof hit === 'object' && 'id' in hit && typeof hit.id === 'string' ? [hit.id] : [],
    ),
  );
  return snapshot.collection.features
    .filter((feature) => ids.has(feature.id))
    .sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id))[0]?.id;
}

export function featureDetails(snapshot: GisSnapshot, id: string): FeatureDetails | undefined {
  const feature = snapshot.collection.features.find((item) => item.id === id);
  if (!feature) return;
  const layer = snapshot.featureLayers.get(id);
  const properties = feature.properties;
  const type = layer?.layerType ?? feature.geometry.type;
  const fields = [{ label: 'Type', value: featureText(type, 120) }];
  const attributes: [string, unknown][] = [
    ['Layer', layer?.name],
    ['Pillar', layer?.pillar],
    ['Difficulty', properties.difficulty],
    ['Surface', properties.surface_type],
    ['Roughness', properties.roughness],
    ['Symbol type', properties.landmark_kind],
    ['Source annotation', properties.source_name],
    ['Source segment', properties.source_segment_id],
    ['Source', layer?.source],
  ];
  for (const [label, value] of attributes) {
    const text = featureText(value, label === 'Source' ? 1000 : 200);
    if (text) fields.push({ label, value: text });
  }
  if (
    typeof properties.average_width_in === 'number' &&
    Number.isFinite(properties.average_width_in) &&
    properties.average_width_in > 0
  ) {
    fields.push({ label: 'Mean tread width', value: `${properties.average_width_in} in` });
  }
  if (
    typeof properties.length_m === 'number' &&
    Number.isFinite(properties.length_m) &&
    properties.length_m >= 0
  ) {
    fields.push({ label: 'Length', value: `${properties.length_m} m` });
  }
  if (Array.isArray(properties.source_annotations)) {
    for (const annotation of properties.source_annotations.slice(0, 8)) {
      const p = annotation && typeof annotation === 'object' ? annotation.properties : undefined;
      if (!p || typeof p !== 'object') continue;
      const name = featureText(p.name, 200);
      const text = featureText(p.description_html, 2000);
      if (name || text)
        fields.push({
          label: 'My Maps annotation',
          value: [name, text].filter(Boolean).join(' · '),
        });
    }
  }
  return {
    title: featureText(properties.name, 200) || 'Map feature',
    description:
      featureText(properties.description) ||
      featureText(properties.description_html) ||
      'No description available.',
    fields,
  };
}
