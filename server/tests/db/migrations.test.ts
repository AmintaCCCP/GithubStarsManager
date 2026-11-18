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
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO schema_version (version) VALUES (3);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE repositories (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, description TEXT, html_url TEXT, stargazers_count INTEGER DEFAULT 0, language TEXT, created_at TEXT, updated_at TEXT, pushed_at TEXT, starred_at TEXT, owner_login TEXT, owner_avatar_url TEXT, topics TEXT, ai_summary TEXT, ai_tags TEXT, ai_platforms TEXT, analyzed_at TEXT, analysis_failed INTEGER DEFAULT 0, custom_description TEXT, custom_tags TEXT, custom_category TEXT, category_locked INTEGER DEFAULT 0, last_edited TEXT, subscribed_to_releases INTEGER DEFAULT 0, vector_indexed_at TEXT, license TEXT, vector_indexed_license TEXT, description_display TEXT, tags_display TEXT);
        CREATE TABLE releases (id INTEGER PRIMARY KEY, tag_name TEXT, name TEXT, body TEXT, html_url TEXT, published_at TEXT, assets TEXT, repo_id INTEGER, repo_full_name TEXT, repo_name TEXT, prerelease INTEGER DEFAULT 0, draft INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, zipball_url TEXT, tarball_url TEXT);
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
        INSERT INTO categories (id, name) VALUES ('legacy-category-1', 'ExistingPrefix');
        INSERT INTO categories (id, name) VALUES ('kept', 'Kept');
      `);

      runMigrations(db);

      const rows = db.prepare('SELECT account_id, id, name FROM categories ORDER BY name').all() as Array<{
        account_id: string;
        id: string;
        name: string;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ account_id: 'default', id: 'legacy-category-1', name: 'ExistingPrefix' });
      expect(rows[1]).toEqual({ account_id: 'default', id: 'kept', name: 'Kept' });
      expect(rows[2]).toMatchObject({ account_id: 'default', name: 'Legacy' });
      expect(rows[2].id).toMatch(/^legacy-category-\d+-[0-9a-f]+$/);
    } finally {
      db.close();
    }
  });
});
