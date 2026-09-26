import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger, morganLoggerStream } from './services/logger.js';
import { mountStaticFrontend } from './services/staticFrontend.js';
import { getDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import healthRouter from './routes/health.js';
import repositoriesRouter from './routes/repositories.js';
import releasesRouter from './routes/releases.js';
import categoriesRouter from './routes/categories.js';
import configsRouter from './routes/configs.js';
import syncRouter from './routes/sync.js';
import authRestoreRouter from './routes/authRestore.js';
import proxyRouter from './routes/proxy.js';
import xtweetRouter from './routes/xtweet.js';
import telegramRouter from './routes/telegram.js';
import logsRouter from './routes/logs.js';
import mcpAdminRouter from './routes/mcp.js';
import { mountMcpRoutes } from './mcp/http.js';

// Origins the SPA is allowed to call directly from the browser. 'self' covers
// the backend proxy; the rest support the "browser direct" route mode
// (GitHub REST/gist APIs and the default AI provider endpoints). Deployments
// with custom AI/worker endpoints can extend this via CSP_CONNECT_SRC
// (comma-separated origins).
const BROWSER_CONNECT_ORIGINS = [
  'https://api.github.com',
  'https://raw.githubusercontent.com',
  'https://gist.githubusercontent.com',
  // Trending discovery fetches GitHubTrendingRSS directly from the browser.
  'https://mshibanami.github.io',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
];

function buildConnectSrc(): string[] {
  const extra = (process.env.CSP_CONNECT_SRC ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return ["'self'", ...BROWSER_CONNECT_ORIGINS, ...extra];
}

export function createApp(): express.Express {
  const app = express();

  // Helmet's default CSP blocks every browser-direct call (api.github.com,
  // avatar images, AI providers), which breaks the supported "browser direct"
  // route mode. Open connect-src/img-src just enough for those origins.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': buildConnectSrc(),
          'img-src': ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );
  app.use(
    cors({
      exposedHeaders: [
        'X-Log-Count',
        'Mcp-Session-Id',
        'mcp-session-id',
        'Retry-After',
        'retry-after-ms',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'x-ratelimit-remaining',
      ],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-MCP-Token',
        'Mcp-Session-Id',
        'mcp-session-id',
        'Last-Event-ID',
      ],
    })
  );
  app.use(morgan('combined', { stream: morganLoggerStream }));
  app.use(express.json({ limit: '50mb' }));

  // Auth middleware for all /api/* except /api/health
  app.use('/api', authMiddleware);

  // Routes
  app.use(healthRouter);

  // Wave 2: Data CRUD routes
  app.use(repositoriesRouter);
  app.use(releasesRouter);
  app.use(categoriesRouter);
  app.use(configsRouter);
  app.use(syncRouter);
  app.use(authRestoreRouter);

  // Wave 3: Proxy routes
  app.use(proxyRouter);
  app.use(xtweetRouter);
  app.use(telegramRouter);

  // Wave 4: Logs route
  app.use(logsRouter);

  // MCP admin API (protected by API_SECRET via /api middleware above)
  app.use(mcpAdminRouter);

  // MCP Streamable HTTP + legacy SSE (own token auth; not under /api)
  // Mount always; each request is gated on live SQLite settings (no write on mount).
  mountMcpRoutes(app);

  // Full-stack images opt in through STATIC_DIR. Standalone backend deployments
  // leave it unset, preserving the previous API-only behavior.
  mountStaticFrontend(app);

  // Global error handler
  app.use(errorHandler);

  return app;
}

function startServer(): void {
  // Initialize database
  const db = getDb();
  runMigrations(db);
  logger.info('server.init', 'Database initialized');

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info('server.start', `Server running on port ${config.port}`);
    if (!config.apiSecret) {
      logger.warn('server.auth', 'Running without API_SECRET — auth is disabled');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('server.shutdown', 'Shutting down...');
    server.close(() => {
      closeDb();
      logger.info('server.shutdown', 'Server stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only start server when run directly (not imported for tests)
const isMainModule =
  process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isMainModule) {
  startServer();
}
