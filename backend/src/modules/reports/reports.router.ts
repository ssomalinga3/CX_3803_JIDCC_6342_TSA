import express, { Router } from 'express';
import { ReportError } from './report-input.js';
import { PhotoError, PHOTO_LIMITS } from './photo-errors.js';
import { reportMultipart } from './report-multipart.js';
import type { ReportSubmissionService } from './submissions.js';

export function reportsRouter(service: ReportSubmissionService): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/report-options', (_req, res) => {
    res.json(service.options());
  });
  router.post(
    '/observations',
    (req, res, next) => {
      if (!/^Bearer [0-9a-f]{64}$/.test(req.get('authorization') ?? '')) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Report ownership proof is required.',
            fields: {},
          },
        });
        return;
      }
      if (!req.is('multipart/form-data')) {
        res.status(415).json({
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Use multipart form data.',
            fields: {},
          },
        });
        return;
      }
      next();
    },
    express.raw({ type: () => true, limit: PHOTO_LIMITS.requestBytes, inflate: false }),
    async (req, res) => {
      try {
        if (!Buffer.isBuffer(req.body)) throw new ReportError('INVALID_REPORT', 400);
        const input = await reportMultipart(req.body, req.get('content-type')!);
        const result = await service.submit(
          input.metadata,
          input.images,
          req.get('authorization')!.slice(7),
        );
        res.status(result.created ? 201 : 200).json({
          observation_id: result.receipt.observationId,
          client_submission_id: result.receipt.clientSubmissionId,
          status: 'accepted',
          accepted_at: result.receipt.acceptedAt.toISOString(),
        });
      } catch (error) {
        const known = error instanceof ReportError || error instanceof PhotoError;
        const code = known ? error.code : 'REPORT_UNAVAILABLE',
          status = known ? error.status : 503;
        const fields = error instanceof ReportError ? error.fields : {};
        if (error instanceof ReportError && error.retryAfter)
          res.set('Retry-After', String(error.retryAfter));
        res
          .status(status)
          .json({ error: { code, message: 'The report could not be accepted.', fields } });
      }
    },
  );
  return router;
}
