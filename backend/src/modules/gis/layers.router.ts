import { Router, type Response } from 'express';
import { parseBbox } from './bbox.js';
import type { LayersRepository } from './types.js';

function error(res: Response, status: number, code: string, message: string, fields = {}) {
  return res
    .set('Cache-Control', 'no-store')
    .status(status)
    .json({ error: { code, message, fields } });
}

export function layersRouter(repository?: LayersRepository): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      if (!repository) throw new Error('Database not configured');
      const catalog = await repository.listPublicLayers();
      res.set('Cache-Control', 'public, max-age=60').json(catalog);
    } catch {
      error(res, 503, 'DATABASE_UNAVAILABLE', 'Layer data is unavailable');
    }
  });
  router.get('/:layerId/features', async (req, res) => {
    let bbox;
    try {
      bbox = parseBbox(req.query.bbox);
    } catch {
      error(res, 400, 'INVALID_BBOX', 'Invalid bounding box', {
        bbox: 'Expected west,south,east,north within longitude/latitude bounds, with west < east and south < north',
      });
      return;
    }
    try {
      if (!repository) throw new Error('Database not configured');
      const collection = await repository.getPublicLayerFeatures(req.params.layerId, bbox);
      if (collection === null) {
        error(res, 404, 'NOT_FOUND', 'Resource not found');
        return;
      }
      res
        .set('Cache-Control', 'public, max-age=60')
        .type('application/geo+json')
        .send(JSON.stringify(collection));
    } catch {
      error(res, 503, 'DATABASE_UNAVAILABLE', 'Layer data is unavailable');
    }
  });
  return router;
}
