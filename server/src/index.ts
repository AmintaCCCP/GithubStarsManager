import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import repositoriesRouter from './routes/repositories.js';
import releasesRouter from './routes/releases.js';
import categoriesRouter from './routes/categories.js';
import configsRouter from './routes/configs.js';
import syncRouter from './routes/sync.js';
import proxyRouter from './routes/proxy.js';
import adminRouter from './routes/admin.js';
import { startReleaseMonitor } from './services/releaseMonitor.js';

export function createApp(): express.Express {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(morgan('combined'));
  app.use(express.json({ limit: '50mb' }));

  // Public routes (no auth required)
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  // Auth middleware for all subsequent /api/* routes
  app.use('/api', authMiddleware);

  // Wave 2: Data CRUD routes
  app.use(repositoriesRouter);
  app.use(releasesRouter);
  app.use(categoriesRouter);
  app.use(configsRouter);
  app.use(syncRouter);

  // Wave 3: Proxy routes
  app.use(proxyRouter);

  // Admin routes
  app.use(adminRouter);

  // Global error handler
  app.use(errorHandler);

  // Serve static UI in production
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const frontendDistPath = path.resolve(__dirname, '../../dist');
  app.use(express.static(frontendDistPath));

  // Handle SPA routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });

  return app;
}

function startServer(): void {
  // Initialize database
  const db = getDb();
  runMigrations(db);
  console.log('✅ Database initialized');

  // Start background services
  startReleaseMonitor();

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
const isMainModule = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isMainModule) {
  startServer();
}
