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
        -- NULL 原样复制会撞 v4 的 NOT NULL 并让整个迁移回滚、后端无法启动；
        -- 追加随机后缀避免与已有 legacy-category-* 冲突。
        SELECT 'default', COALESCE(id, 'legacy-category-' || rowid || '-' || lower(hex(randomblob(8)))), name, description, icon, keywords, color, COALESCE(sort_order, 0), COALESCE(is_custom, 1)
        FROM categories;

        DROP TABLE categories;
        ALTER TABLE categories_v4 RENAME TO categories;
      `);
    }

    // 固化 v4 迁移时刻的存量全局 github_token，避免后续无头客户端覆盖 settings.github_token
    // 后被误用于判定存量 default 数据的归属。
    // Issue #612 R2-A8：仅在确认存在待认领旧数据时执行——检查范围同时涵盖
    // 仓库/发行版/分类数据与旧账号级设置（v4 之前账号级键存放在全局 settings
    // 表；github_token 本身是快照来源而非待认领数据）。无任何旧数据（全新库或
    // 已清空的存量库）时不冻结 PAT，保留现有密文保存逻辑。
    const hasLegacyDefaultData = db.prepare(`
      SELECT 1 AS one
      WHERE EXISTS (SELECT 1 FROM repositories)
         OR EXISTS (SELECT 1 FROM releases)
         OR EXISTS (SELECT 1 FROM categories)
         OR EXISTS (
           SELECT 1 FROM settings WHERE key IN (
             'customCategories', 'categoryOrder', 'hiddenDefaultCategoryIds',
             'defaultCategoryOverrides', 'releaseSourceSettings', 'categoryListIdMap',
             'syncMode', 'syncModeConfigured'
           )
         )
    `).get();
    if (hasLegacyDefaultData) {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value)
        SELECT 'legacy_default_github_token', value
        FROM settings
        WHERE key = 'github_token' AND value IS NOT NULL AND value != '';
      `);
    }
  },
  5: (db) => {
    // 跨账号 AI 成果回填子查询按纯 id 条件检索捐赠行（account_id != ?），
    // 复合主键 (account_id, id) 无法命中；补充独立索引避免全表扫描。
    db.exec('CREATE INDEX IF NOT EXISTS idx_repositories_repo_id ON repositories(id)');
  },
  6: (db) => {
    // Issue #612 A21：跨账号 AI 成果共享标记。写入 ai_* 的路由按账号的
    // ai_result_sharing_enabled 设置置位；跨账号复用（冲突更新与批量回填）
    // 只选择已授权共享的来源记录，同账号内复用不受影响。
    addColumnIfMissing(db, 'repositories', 'ai_shared', 'INTEGER DEFAULT 0');
    // Issue #612 A20x：每账号分区的仓库快照版本（repo_revision）等服务端自身
    // 的分区级元数据。独立于 account_settings 存储，避免被备份导出/导入或
    // /api/settings 写路径覆盖而破坏单调性。
    db.exec(`
      CREATE TABLE IF NOT EXISTS partition_meta (
        account_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (account_id, key)
      );
    `);
  },
  7: (db) => {
    // Issue #612 R2-A10：AI 字段共享授权按字段记录——PATCH/增量 PUT 只授权
    // 本次提交的 AI 字段，不得因更新任一 AI 字段就把整行（含旧的、此前未授权
    // 的字段）标记为可共享；回填查询按 ai_*_shared 字段授权过滤。
    // 存量 ai_shared = 1 的行迁移为三列同值（迁移时无法重建历史授权顺序；
    // 回填子查询本就要求字段非空，空字段上的授权位无实际效果）。
    addColumnIfMissing(db, 'repositories', 'ai_summary_shared', 'INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'repositories', 'ai_tags_shared', 'INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'repositories', 'ai_platforms_shared', 'INTEGER DEFAULT 0');
    db.exec(`
      UPDATE repositories SET
        ai_summary_shared = ai_shared,
        ai_tags_shared = ai_shared,
        ai_platforms_shared = ai_shared
      WHERE ai_shared = 1;
    `);
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
