import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const backendPathPrefixes = ['/api', '/mcp', '/sse', '/messages'];

function isBackendPath(requestPath: string): boolean {
  return backendPathPrefixes.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

/**
 * Optionally serves a compiled frontend from the directory configured by STATIC_DIR.
 *
 * The standalone backend image intentionally does not set STATIC_DIR, so its routes
 * and 404 behavior remain unchanged. The full-stack image sets STATIC_DIR=/app/public.
 */
export function mountStaticFrontend(app: Express, staticDir = process.env.STATIC_DIR): boolean {
  if (!staticDir) {
    return false;
  }

  const resolvedStaticDir = path.resolve(staticDir);
  const indexFile = path.join(resolvedStaticDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return false;
  }

  const serveStatic = express.static(resolvedStaticDir, { index: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isBackendPath(req.path)) {
      next();
      return;
    }

    serveStatic(req, res, next);
  });

  // Register this after all API and MCP routes. Keep their unknown paths as 404s
  // instead of returning the SPA shell.
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (isBackendPath(req.path)) {
      next();
      return;
    }

    res.sendFile(indexFile, (error) => {
      if (error) {
        next(error);
      }
    });
  });

  return true;
}
