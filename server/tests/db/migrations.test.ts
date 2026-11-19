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

  it('adds ai_shared and partition_meta idempotently in migration v6 (Issue #612 A21/A20x)', () => {
    const db = new Database(':memory:');
    try {
      // v3 形态的存量库：跑完整迁移后应包含 v6 产物
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO schema_version (version) VALUES (3);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE repositories (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, description TEXT, html_url TEXT, stargazers_count INTEGER DEFAULT 0, language TEXT, created_at TEXT, updated_at TEXT, pushed_at TEXT, starred_at TEXT, owner_login TEXT, owner_avatar_url TEXT, topics TEXT, ai_summary TEXT, ai_tags TEXT, ai_platforms TEXT, analyzed_at TEXT, analysis_failed INTEGER DEFAULT 0, custom_description TEXT, custom_tags TEXT, custom_category TEXT, category_locked INTEGER DEFAULT 0, last_edited TEXT, subscribed_to_releases INTEGER DEFAULT 0, vector_indexed_at TEXT, license TEXT, vector_indexed_license TEXT, description_display TEXT, tags_display TEXT);
        CREATE TABLE releases (id INTEGER PRIMARY KEY, tag_name TEXT, name TEXT, body TEXT, html_url TEXT, published_at TEXT, assets TEXT, repo_id INTEGER, repo_full_name TEXT, repo_name TEXT, prerelease INTEGER DEFAULT 0, draft INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, zipball_url TEXT, tarball_url TEXT);
        CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT NOT NULL DEFAULT '📁', keywords TEXT, color TEXT, sort_order INTEGER DEFAULT 0, is_custom INTEGER DEFAULT 1);
        INSERT INTO repositories (id, name, full_name, html_url, owner_login) VALUES (1, 'repo', 'owner/repo', 'https://github.com/owner/repo', 'owner');
      `);

      runMigrations(db);

      const repoColumns = (db.prepare('PRAGMA table_info(repositories)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(repoColumns).toContain('ai_shared');
      // 新库/迁移库中存量行的默认共享标记为 0
      expect(db.prepare('SELECT ai_shared FROM repositories WHERE id = 1').get())
        .toMatchObject({ ai_shared: 0 });
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partition_meta'").all() as Array<{ name: string }>);
      expect(tables).toHaveLength(1);

      // 幂等性：把 schema_version 回退到 5 后重新应用 v6，不得报错、不得改变数据
      db.prepare('DELETE FROM schema_version WHERE version = 6').run();
      runMigrations(db);
      const repoColumnsAfterRerun = (db.prepare('PRAGMA table_info(repositories)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(repoColumnsAfterRerun.filter((name) => name === 'ai_shared')).toHaveLength(1);
      expect(db.prepare('SELECT COUNT(*) AS total FROM partition_meta').get()).toMatchObject({ total: 0 });
      expect(db.prepare('SELECT account_id, id FROM repositories').all())
        .toEqual([{ account_id: 'default', id: 1 }]);
    } finally {
      db.close();
    }
  });
});

describe('v4 legacy default PAT snapshot gating (Issue #612 R2-A8)', () => {
  // 与上方 v6 测试相同的完整 v3 形态（迁移重建按列复制，缺列会失败）
  const v3Schema = (db: import('better-sqlite3').Database): void => {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (3);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE repositories (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, description TEXT, html_url TEXT, stargazers_count INTEGER DEFAULT 0, language TEXT, created_at TEXT, updated_at TEXT, pushed_at TEXT, starred_at TEXT, owner_login TEXT, owner_avatar_url TEXT, topics TEXT, ai_summary TEXT, ai_tags TEXT, ai_platforms TEXT, analyzed_at TEXT, analysis_failed INTEGER DEFAULT 0, custom_description TEXT, custom_tags TEXT, custom_category TEXT, category_locked INTEGER DEFAULT 0, last_edited TEXT, subscribed_to_releases INTEGER DEFAULT 0, vector_indexed_at TEXT, license TEXT, vector_indexed_license TEXT, description_display TEXT, tags_display TEXT);
      CREATE TABLE releases (id INTEGER PRIMARY KEY, tag_name TEXT, name TEXT, body TEXT, html_url TEXT, published_at TEXT, assets TEXT, repo_id INTEGER, repo_full_name TEXT, repo_name TEXT, prerelease INTEGER DEFAULT 0, draft INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, zipball_url TEXT, tarball_url TEXT);
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT NOT NULL DEFAULT '📁', keywords TEXT, color TEXT, sort_order INTEGER DEFAULT 0, is_custom INTEGER DEFAULT 1);
    `);
  };

  it('does not freeze the PAT when the database holds no pending legacy data', () => {
    const db = new Database(':memory:');
    try {
      v3Schema(db);
      // 仅配置了全局 Token：无仓库/发行版/分类/旧账号级设置 → 不冻结
      db.prepare("INSERT INTO settings (key, value) VALUES ('github_token', 'legacy-token')").run();

      runMigrations(db);

      expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_github_token'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('freezes the PAT when legacy account-level settings exist even without repository rows', () => {
    const db = new Database(':memory:');
    try {
      v3Schema(db);
      db.prepare("INSERT INTO settings (key, value) VALUES ('github_token', 'legacy-token')").run();
      // 旧账号级设置（v4 之前存放在全局 settings 表）属于待认领旧数据
      db.prepare("INSERT INTO settings (key, value) VALUES ('customCategories', ?)").run('["legacy"]');

      runMigrations(db);

      expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_github_token'").get())
        .toMatchObject({ value: 'legacy-token' });
    } finally {
      db.close();
    }
  });

  it('freezes the PAT when legacy repository rows exist', () => {
    const db = new Database(':memory:');
    try {
      v3Schema(db);
      db.prepare("INSERT INTO settings (key, value) VALUES ('github_token', 'legacy-token')").run();
      db.prepare("INSERT INTO repositories (id, name, full_name, html_url, owner_login) VALUES (1, 'repo', 'owner/repo', 'https://github.com/owner/repo', 'owner')").run();

      runMigrations(db);

      expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_github_token'").get())
        .toMatchObject({ value: 'legacy-token' });
    } finally {
      db.close();
    }
  });
});
