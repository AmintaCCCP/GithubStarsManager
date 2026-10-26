import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { parse } from 'parse5';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger, morganLoggerStream } from './services/logger.js';
import { mountStaticFrontend, resolveSpaIndexFile } from './services/staticFrontend.js';
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
import oauthRouter from './routes/oauth.js';
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

/**
 * @vitejs/plugin-legacy injects inline bootstrap scripts and a `data:` module
 * into the SPA shell. Hash the served copy so `script-src` stays free of
 * 'unsafe-inline' and follows every rebuild, where hardcoded hashes would drift.
 * The shell is parsed as HTML rather than pattern-matched so the hashes cover
 * exactly what the browser will execute.
 */
type HtmlNode = {
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  attrs?: Array<{ name: string; value: string }>;
};

function collectInlineScripts(node: HtmlNode, scripts: string[]): void {
  if (node.tagName === 'script' && !node.attrs?.some((attr) => attr.name === 'src')) {
    const body = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
    if (body.trim().length > 0) {
      scripts.push(body);
    }
  }
  for (const child of node.childNodes ?? []) {
    collectInlineScripts(child, scripts);
  }
}

function buildScriptSrc(): string[] {
  const indexFile = resolveSpaIndexFile();
  if (!indexFile) {
    return ["'self'"];
  }

  let html: string;
  try {
    html = fs.readFileSync(indexFile, 'utf8');
  } catch (error) {
    logger.warn('csp', `Could not read ${indexFile}; serving a strict script-src`, error);
    return ["'self'"];
  }

  const scripts: string[] = [];
  collectInlineScripts(parse(html) as HtmlNode, scripts);

  const hashes = scripts.map(
    (body) => `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`
  );
  const directives = ["'self'", ...new Set(hashes)];
  if (html.toLowerCase().includes('data:text/javascript')) {
    directives.push('data:');
  }
  return directives;
}

/**
 * Helmet's default `upgrade-insecure-requests` rewrites the SPA's own http://
 * assets to https://, so plain HTTP deployments (e.g. `http://<lan-ip>:3000`)
 * fail every script with ERR_SSL_PROTOCOL_ERROR and stay blank. Browsers ignore
 * HSTS received over HTTP, so only this directive needs an opt-out.
 */
function shouldUpgradeInsecureRequests(): boolean {
  return !/^(0|false|no)$/i.test(process.env.CSP_UPGRADE_INSECURE_REQUESTS?.trim() ?? '');
}

/**
 * Creates and configures the Express application instance with security headers,
 * proxy trust settings, rate limiting, and all backend API and static routes.
 *
 * @returns Configured Express application.
 */
export function createApp(): express.Express {
  const app = express();
  const upgradeInsecureRequests = shouldUpgradeInsecureRequests();

  // Helmet's default CSP blocks every browser-direct call (api.github.com,
  // avatar images, AI providers), which breaks the supported "browser direct"
  // route mode. Open connect-src/img-src just enough for those origins.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': buildConnectSrc(),
          'img-src': ["'self'", 'data:', 'https:'],
          'script-src': buildScriptSrc(),
          ...(upgradeInsecureRequests ? {} : { 'upgrade-insecure-requests': null }),
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
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'RateLimit-Policy',
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

  // In separated deployments behind a trusted reverse proxy (e.g. Nginx),
  // trust the immediate proxy hop so req.ip reflects the actual client IP.
  // Full-stack single-process deployments (with STATIC_DIR) do not trust proxies
  // by default unless explicitly configured via TRUST_PROXY.
  if (process.env.TRUST_PROXY) {
    const rawTrustProxy = process.env.TRUST_PROXY.trim();
    if (rawTrustProxy === 'true') {
      app.set('trust proxy', true);
    } else if (rawTrustProxy === 'false') {
      app.set('trust proxy', false);
    } else if (/^\d+$/.test(rawTrustProxy)) {
      app.set('trust proxy', parseInt(rawTrustProxy, 10));
    } else {
      app.set('trust proxy', rawTrustProxy);
    }
  } else {
    app.set('trust proxy', false);
  }

  // Global rate limiter to protect database and endpoints from DoS before body parsing
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
  });
  app.use(limiter);
  app.use(express.json({ limit: '50mb' }));

  // OAuth login routes: mounted before the auth middleware so the login page
  // and GitHub's callback can reach them without an API_SECRET bearer token.
  app.use(oauthRouter);

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
