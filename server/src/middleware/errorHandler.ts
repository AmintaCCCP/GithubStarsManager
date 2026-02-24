import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Unhandled error:', err.stack || err.message);

  const statusCode = (err as Error & { statusCode?: number }).statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(statusCode).json({ error: message, code: 'INTERNAL_SERVER_ERROR' });
}
