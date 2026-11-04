import express, { type Express, type Request, type Response } from 'express';

/**
 * Builds the Express application without binding to a network port.
 *
 * Keeping app construction separate from the HTTP listener (see server.ts)
 * lets tests exercise routes in-process with supertest and lets future
 * composition (routers, middleware, data access) attach here.
 *
 * This foundation exposes operational /health and database /ready routes. The
 * domain surface in docs/api.md (layers, observations) is deferred to the
 * first implementation task so that unresolved decisions (D-01, D-03, D-12)
 * are not pre-empted here.
 */
export interface AppDependencies {
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
