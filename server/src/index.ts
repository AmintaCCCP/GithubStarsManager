import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import healthRouter from './routes/health.js';
import repositoriesRouter from './routes/repositories.js';
import releasesRouter from './routes/releases.js';
import categoriesRouter from './routes/categories.js';
import configsRouter from './routes/configs.js';
import syncRouter from './routes/sync.js';
import proxyRouter from './routes/proxy.js';

export function createApp(): express.Express {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(morgan('combined'));
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

  // Wave 3: Proxy routes
  app.use(proxyRouter);

  // Global error handler
  app.use(errorHandler);

  return app;
}

function startServer(): void {
  // Initialize database
  const db = getDb();
  runMigrations(db);
  console.log('✅ Database initialized');

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
    if (!config.apiSecret) {
      console.warn('⚠️  Running without API_SECRET — auth is disabled');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    server.close(() => {
      closeDb();
      console.log('👋 Server stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only start server when run directly (not imported for tests)
const isMainModule = process.argv[1] && new URL(import.meta.url).pathname === (process.platform === 'win32' ? process.argv[1].replace(/\\/g, '/') : process.argv[1]);
if (isMainModule) {
  startServer();
}
