import { distanceToTrailMeters, insidePreserve, type OffTrailGeometry } from '@/data/off-trail';

/**
 * Deterministic known positions derived from the supplied trail geometry: a trail
 * vertex, a point inside the jitter band, a point clearly off-trail inside the
 * preserve, a point outside the preserve and a short walk between them.
 */
export function offTrailPoints(geometry: OffTrailGeometry) {
  const meters = 1 / 111_000;
  for (const line of geometry.lines) {
    const onTrail = line[Math.floor(line.length / 2)];
    if (!insidePreserve(geometry, onTrail)) continue;
    for (let angle = 0; angle < 360; angle += 15) {
      const radians = (angle * Math.PI) / 180;
      const at = (distance: number) => [
        onTrail[0] +
          (Math.cos(radians) * distance * meters) / Math.cos((onTrail[1] * Math.PI) / 180),
        onTrail[1] + Math.sin(radians) * distance * meters,
      ];
      let band: number[] | undefined;
      let offTrail: number[] | undefined;
      let step = 0;
      // The ray must stay inside the preserve and move steadily away from every trail.
      for (let previous = 0; step <= 60; step += 1) {
        const point = at(step);
        const distance = distanceToTrailMeters(geometry, point);
        if (!insidePreserve(geometry, point) || distance + 0.5 < previous) break;
        previous = distance;
        if (!band && distance > 14 && distance < 18) band = point;
        if (distance > 40) {
          offTrail = point;
          break;
        }
      }
      if (!band || !offTrail) continue;
      const out = Array.from({ length: step + 1 }, (_, i) => at(i));
      const route = [
        ...Array(3).fill(onTrail),
        ...out.filter((_, i) => i % 2 === 0),
        ...Array(3).fill(offTrail),
        ...out.filter((_, i) => i % 2 === 0).reverse(),
        ...Array(3).fill(onTrail),
      ];
      return { onTrail, band, offTrail, outside: [-84.388, 33.749], route };
    }
  }
  throw new Error('No off-trail test positions found in the supplied geometry');
}
