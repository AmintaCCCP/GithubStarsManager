import type Database from 'better-sqlite3';
import { initializeSchema, addColumnIfMissing } from './schema.js';
import { logger } from '../services/logger.js';

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((col) => col.name === column);
}

const migrations: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    initializeSchema(db);
  },
  2: (db) => {
    addColumnIfMissing(db, 'webdav_configs', 'custom_user_agent', 'TEXT');
  },
  3: (db) => {
    addColumnIfMissing(db, 'repositories', 'description_display', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'tags_display', 'TEXT');
  },
  4: (db) => {
    // v4 多账号隔离（Issue #611）：账号元数据表 + 账号级设置表 +
    // repositories/releases/categories 升级为 (account_id, id) 复合主键。
    // 'default' 分区与旧版无租户数据 100% 兼容（存量行自动归属 default）。
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        github_token_encrypted TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS account_settings (
        account_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (account_id, key)
      );
    `);

    // 重建前确保可选列存在，避免旧库缺失列导致 INSERT INTO ... SELECT 失败。
    addColumnIfMissing(db, 'repositories', 'category_locked', 'INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'repositories', 'description_display', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'tags_display', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'last_edited', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'subscribed_to_releases', 'INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'repositories', 'vector_indexed_at', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'license', 'TEXT');
    addColumnIfMissing(db, 'repositories', 'vector_indexed_license', 'TEXT');
    addColumnIfMissing(db, 'releases', 'zipball_url', 'TEXT');
    addColumnIfMissing(db, 'releases', 'tarball_url', 'TEXT');
    addColumnIfMissing(db, 'categories', 'description', 'TEXT');
    addColumnIfMissing(db, 'categories', 'color', 'TEXT');
    addColumnIfMissing(db, 'categories', 'sort_order', 'INTEGER DEFAULT 0');

    // 全新数据库（v4 基础定义）已带 account_id：跳过重建，仅补索引。
    if (!tableHasColumn(db, 'repositories', 'account_id')) {
      db.exec(`
        CREATE TABLE repositories_v4 (
          account_id TEXT NOT NULL DEFAULT 'default',
          id INTEGER NOT NULL,
          name TEXT NOT NULL,
          full_name TEXT NOT NULL,
          description TEXT,
          html_url TEXT NOT NULL,
          stargazers_count INTEGER DEFAULT 0,
          language TEXT,
          created_at TEXT,
          updated_at TEXT,
          pushed_at TEXT,
          starred_at TEXT,
          owner_login TEXT NOT NULL,
          owner_avatar_url TEXT,
          topics TEXT,
          ai_summary TEXT,
          ai_tags TEXT,
          ai_platforms TEXT,
          analyzed_at TEXT,
          analysis_failed INTEGER DEFAULT 0,
          custom_description TEXT,
          custom_tags TEXT,
          custom_category TEXT,
          category_locked INTEGER DEFAULT 0,
          description_display TEXT,
          tags_display TEXT,
          last_edited TEXT,
          subscribed_to_releases INTEGER DEFAULT 0,
          vector_indexed_at TEXT,
          license TEXT,
          vector_indexed_license TEXT,
          PRIMARY KEY (account_id, id),
          UNIQUE (account_id, full_name)
        );

        INSERT INTO repositories_v4 (
          account_id, id, name, full_name, description, html_url, stargazers_count, language,
          created_at, updated_at, pushed_at, starred_at, owner_login, owner_avatar_url, topics,
          ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
          custom_description, custom_tags, custom_category, category_locked,
          description_display, tags_display, last_edited, subscribed_to_releases,
          vector_indexed_at, license, vector_indexed_license
        )
        SELECT
          'default', id, name, full_name, description, html_url, stargazers_count, language,
          created_at, updated_at, pushed_at, starred_at, owner_login, owner_avatar_url, topics,
          ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
          custom_description, custom_tags, custom_category, COALESCE(category_locked, 0),
          description_display, tags_display, last_edited, COALESCE(subscribed_to_releases, 0),
          vector_indexed_at, license, vector_indexed_license
        FROM repositories;

        DROP TABLE repositories;
        ALTER TABLE repositories_v4 RENAME TO repositories;
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_repositories_account_stars
        ON repositories(account_id, stargazers_count DESC);
    `);

    if (!tableHasColumn(db, 'releases', 'account_id')) {
      db.exec(`
        CREATE TABLE releases_v4 (
          account_id TEXT NOT NULL DEFAULT 'default',
          id INTEGER NOT NULL,
          tag_name TEXT NOT NULL,
          name TEXT,
          body TEXT,
          published_at TEXT,
          html_url TEXT,
          assets TEXT,
          repo_id INTEGER NOT NULL,
          repo_full_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          prerelease INTEGER DEFAULT 0,
          draft INTEGER DEFAULT 0,
          is_read INTEGER DEFAULT 0,
          zipball_url TEXT,
          tarball_url TEXT,
          PRIMARY KEY (account_id, id)
        );

        INSERT INTO releases_v4 (
          account_id, id, tag_name, name, body, published_at, html_url, assets,
          repo_id, repo_full_name, repo_name, prerelease, draft, is_read, zipball_url, tarball_url
        )
        SELECT
          'default', id, tag_name, name, body, published_at, html_url, assets,
          repo_id, repo_full_name, repo_name, COALESCE(prerelease, 0), COALESCE(draft, 0), COALESCE(is_read, 0), zipball_url, tarball_url
        FROM releases;

        DROP TABLE releases;
        ALTER TABLE releases_v4 RENAME TO releases;
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_releases_account_published
        ON releases(account_id, published_at DESC);
    `);

    if (!tableHasColumn(db, 'categories', 'account_id')) {
      db.exec(`
        CREATE TABLE categories_v4 (
          account_id TEXT NOT NULL DEFAULT 'default',
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT NOT NULL DEFAULT '📁',
          keywords TEXT,
          color TEXT,
          sort_order INTEGER DEFAULT 0,
          is_custom INTEGER DEFAULT 1,
          PRIMARY KEY (account_id, id)
        );

        INSERT INTO categories_v4 (account_id, id, name, description, icon, keywords, color, sort_order, is_custom)
        -- v3 的 id 是可空 TEXT PRIMARY KEY（旧 POST /api/categories 不写 id）：
        -- NULL 原样复制会撞 v4 的 NOT NULL 并让整个迁移回滚、后端无法启动。
        SELECT 'default', COALESCE(id, 'legacy-category-' || rowid), name, description, icon, keywords, color, COALESCE(sort_order, 0), COALESCE(is_custom, 1)
        FROM categories;

        DROP TABLE categories;
        ALTER TABLE categories_v4 RENAME TO categories;
      `);
    }
  },
  5: (db) => {
    // 跨账号 AI 成果回填子查询按纯 id 条件检索捐赠行（account_id != ?），
    // 复合主键 (account_id, id) 无法命中；补充独立索引避免全表扫描。
    db.exec('CREATE INDEX IF NOT EXISTS idx_repositories_repo_id ON repositories(id)');
  },
};

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists first
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersionRow = db
    .prepare('SELECT MAX(version) as version FROM schema_version')
    .get() as { version: number | null } | undefined;

  const currentVersion = currentVersionRow?.version ?? 0;
  const targetVersion = Math.max(...Object.keys(migrations).map(Number));

  if (currentVersion >= targetVersion) {
    return;
  }

  const applyMigration = db.transaction(() => {
    for (let v = currentVersion + 1; v <= targetVersion; v++) {
      const migration = migrations[v];
      if (migration) {
        logger.info('db.migration', `Applying migration v${v}...`);
        migration(db);
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v);
        logger.info('db.migration', `Migration v${v} applied.`);
      }
    }
  });

  applyMigration();
}
