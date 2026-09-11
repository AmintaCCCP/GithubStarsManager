import { initializeSchema } from './schema.js';
import { db } from './client.js';
import { logger } from '../services/logger.js';

export async function runMigrations(): Promise<void> {
  // Ensure schema_version table exists first
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersionRow = await db.get<{ version: number | null }>(
    'SELECT MAX(version) as version FROM schema_version'
  );
  const currentVersion = currentVersionRow?.version ?? 0;

  // v1: 建表 + 增量列
  if (currentVersion < 1) {
    logger.info('db.migration', 'Applying migration v1...');
    await initializeSchema();
    await db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', 1);
    logger.info('db.migration', 'Migration v1 applied.');
  }
}
