import { describe, expect, it } from 'vitest';

async function loadDatabase() {
  try {
    return (await import('better-sqlite3')).default;
  } catch {
    return null;
  }
}

describe('database migrations', () => {
  it('adds updated_asset_ids when upgrading an existing v1 database', async () => {
    const Database = await loadDatabase();
    if (!Database) return;

    const { runMigrations } = await import('../../src/db/migrations.js');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO schema_version (version) VALUES (1);
      CREATE TABLE releases (id INTEGER PRIMARY KEY);
    `);

    try {
      runMigrations(db);

      const columns = db.prepare('PRAGMA table_info(releases)').all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      const updatedAssetIds = columns.find((column) => column.name === 'updated_asset_ids');

      expect(updatedAssetIds).toBeDefined();
      expect(updatedAssetIds?.dflt_value).toBe("'[]'");
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 2 });
    } finally {
      db.close();
    }
  });
});
