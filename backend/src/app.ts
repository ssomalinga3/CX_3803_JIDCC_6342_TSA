import { layersRouter } from './modules/gis/layers.router.js';
import type { LayersRepository } from './modules/gis/types.js';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from 'express';

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

  // Express's default handler logs raw errors (including parser input). Keep
  // request bodies, URLs and dependency details out of responses and output.
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    void next; // Express requires four arguments to recognize error middleware.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    const badRequest =
      error && typeof error === 'object' && 'status' in error && error.status === 400;
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Request could not be completed';
    if (type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Invalid JSON body';
    } else if (type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body is too large';
    } else if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
      status = 415;
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = 'Unsupported request encoding';
    } else if (badRequest) {
      status = 400;
      code = 'INVALID_REQUEST';
      message = 'Invalid request';
    }
    res
      .status(status)
      .set('Cache-Control', 'no-store')
      .json({ error: { code, message, fields: {} } });
  };
  app.use(handleError);

  return app;
}
