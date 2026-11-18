import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';

describe('migrations', () => {
  it('keeps v3 categories whose id is NULL and assigns them a usable id', () => {
    const db = new Database(':memory:');
    try {
      // v3 schema: `id TEXT PRIMARY KEY` is nullable, and the old
      // POST /api/categories never wrote an id.
      db.exec(`
        CREATE TABLE categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT NOT NULL DEFAULT '📁',
          keywords TEXT,
          color TEXT,
          sort_order INTEGER DEFAULT 0,
          is_custom INTEGER DEFAULT 1
        );
        INSERT INTO categories (id, name) VALUES (NULL, 'Legacy');
        INSERT INTO categories (id, name) VALUES ('kept', 'Kept');
      `);

      runMigrations(db);

      const rows = db.prepare('SELECT account_id, id, name FROM categories ORDER BY name').all() as Array<{
        account_id: string;
        id: string;
        name: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ account_id: 'default', id: 'kept', name: 'Kept' });
      expect(rows[1]).toMatchObject({ account_id: 'default', name: 'Legacy' });
      expect(rows[1].id).toMatch(/^legacy-category-\d+$/);
    } finally {
      db.close();
    }
  });
});
