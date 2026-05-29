import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.errorFromError('errorHandler.global', 'Unhandled error', err);

  if (res.headersSent) {
    return _next(err);
  }

  const errWithMeta = err as Error & { statusCode?: number; code?: string };
  const statusCode = errWithMeta.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';
  const code = errWithMeta.code || 'INTERNAL_SERVER_ERROR';

  res.status(statusCode).json({ error: message, code });
}