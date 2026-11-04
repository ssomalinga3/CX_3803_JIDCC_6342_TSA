import { layersRouter } from './modules/gis/layers.router.js';
import type { LayersRepository } from './modules/gis/types.js';
import express, { type Express, type Request, type Response } from 'express';

export interface AppDependencies {
  layers?: LayersRepository;
  checkReadiness?: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Dependency readiness is separate from process liveness. Never expose DB errors.
  app.get('/ready', async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!dependencies.checkReadiness) throw new Error('Database not configured');
      await dependencies.checkReadiness();
      res.status(200).json({ status: 'ok', database: 'ok' });
    } catch {
      res.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database is not ready',
          fields: {},
        },
      });
    }
  });

  app.use('/api/v1/layers', layersRouter(dependencies.layers));

  // Fallback 404 using the structured error envelope from docs/api.md.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        fields: {},
      },
    });
  });

  return app;
}
