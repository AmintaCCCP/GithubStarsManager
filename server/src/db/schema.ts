import type Database from 'better-sqlite3';

export function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- v4 多账号隔离：repositories/releases/categories 以 (account_id, id) 为复合主键，
    -- 与 Migration v4 重建后的形状逐列一致，保证全新数据库与升级数据库不漂移。
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

    CREATE TABLE IF NOT EXISTS repositories (
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
      ai_shared INTEGER DEFAULT 0,
      -- Issue #612 R2-A10：按字段的 AI 成果共享授权位（与 v7 迁移一致）。
      ai_summary_shared INTEGER DEFAULT 0,
      ai_tags_shared INTEGER DEFAULT 0,
      ai_platforms_shared INTEGER DEFAULT 0,
      PRIMARY KEY (account_id, id),
      UNIQUE (account_id, full_name)
    );

    CREATE TABLE IF NOT EXISTS releases (
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

    CREATE TABLE IF NOT EXISTS categories (
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

    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_type TEXT DEFAULT 'openai',
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      model TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      custom_prompt TEXT,
      use_custom_prompt INTEGER DEFAULT 0,
      concurrency INTEGER DEFAULT 1,
      reasoning_effort TEXT,
      mimo_plan TEXT
    );

    CREATE TABLE IF NOT EXISTS webdav_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      is_active INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS asset_filters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      keywords TEXT,
      platform TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 每账号分区的服务端自身元数据（repo_revision 等内部状态）。
    -- 独立于 account_settings：不会被备份导出/导入，也不会经 /api/settings 暴露。
    CREATE TABLE IF NOT EXISTS partition_meta (
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (account_id, key)
    );

    CREATE TABLE IF NOT EXISTS embedding_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_type TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT NOT NULL DEFAULT '',
      api_key_encrypted TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 1536,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vector_search_configs (
      id TEXT PRIMARY KEY DEFAULT 'default',
      enabled INTEGER NOT NULL DEFAULT 0,
      worker_url TEXT NOT NULL DEFAULT '',
      auth_token_encrypted TEXT NOT NULL DEFAULT '',
      embedding_config_id TEXT,
      index_mode TEXT NOT NULL DEFAULT 'readme',
      readme_max_chars INTEGER NOT NULL DEFAULT 6000,
      search_threshold REAL DEFAULT 0.35,
      search_top_k INTEGER DEFAULT 30,
      enable_hyde INTEGER DEFAULT 1,
      enable_reranking INTEGER DEFAULT 1,
      embedding_format_version INTEGER,
      status_json TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  addColumnIfMissing(db, 'ai_configs', 'reasoning_effort', 'TEXT');
  addColumnIfMissing(db, 'ai_configs', 'mimo_plan', 'TEXT');
  addColumnIfMissing(db, 'repositories', 'category_locked', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'repositories', 'description_display', 'TEXT');
  addColumnIfMissing(db, 'repositories', 'tags_display', 'TEXT');
  addColumnIfMissing(db, 'releases', 'zipball_url', 'TEXT');
  addColumnIfMissing(db, 'releases', 'tarball_url', 'TEXT');
  addColumnIfMissing(db, 'categories', 'description', 'TEXT');
  addColumnIfMissing(db, 'categories', 'color', 'TEXT');
  addColumnIfMissing(db, 'categories', 'sort_order', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'asset_filters', 'description', 'TEXT');
  addColumnIfMissing(db, 'asset_filters', 'platform', 'TEXT');
  addColumnIfMissing(db, 'asset_filters', 'sort_order', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'vector_search_configs', 'index_mode', "TEXT NOT NULL DEFAULT 'readme'");
  addColumnIfMissing(db, 'vector_search_configs', 'readme_max_chars', 'INTEGER NOT NULL DEFAULT 6000');
  addColumnIfMissing(db, 'vector_search_configs', 'search_threshold', 'REAL DEFAULT 0.35');
  addColumnIfMissing(db, 'vector_search_configs', 'search_top_k', 'INTEGER DEFAULT 30');
  addColumnIfMissing(db, 'vector_search_configs', 'enable_hyde', 'INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'vector_search_configs', 'enable_reranking', 'INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'vector_search_configs', 'embedding_format_version', 'INTEGER');
  addColumnIfMissing(db, 'repositories', 'vector_indexed_at', 'TEXT');
  addColumnIfMissing(db, 'repositories', 'license', 'TEXT');
  addColumnIfMissing(db, 'webdav_configs', 'custom_user_agent', 'TEXT');
  // 上一次向量索引时采用的 license 值（SPDX id / null）。用于增量谓词判断 license 是否
  // 变化：当期 license 与此值不一致时需重新索引，保证 license 变更能使向量元数据失效。
  addColumnIfMissing(db, 'repositories', 'vector_indexed_license', 'TEXT');
  // 跨账号 AI 成果共享标记（Issue #612 A21）：写入 ai_* 的路由按账号设置置位。
  addColumnIfMissing(db, 'repositories', 'ai_shared', 'INTEGER DEFAULT 0');
  // 按字段的 AI 成果共享授权位（Issue #612 R2-A10，v7 迁移同样补列）。
  addColumnIfMissing(db, 'repositories', 'ai_summary_shared', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'repositories', 'ai_tags_shared', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'repositories', 'ai_platforms_shared', 'INTEGER DEFAULT 0');

  // 跨账号 AI 成果回填子查询（repositories.ts / accountScope.ts）按 `id = ? AND
  // account_id != ?` 检索捐赠行；复合主键 (account_id, id) 无法命中纯 id 条件，
  // 需要独立索引避免同步退化为全表扫描。
  db.exec('CREATE INDEX IF NOT EXISTS idx_repositories_repo_id ON repositories(id)');
}
