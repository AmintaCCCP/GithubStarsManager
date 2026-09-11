import { db } from './client.js';

/**
 * 幂等添加列：若目标表缺列则 ALTER TABLE ADD COLUMN。
 * 远端（Turso）不支持 PRAGMA table_info，统一走 db.pragma() 抽象。
 */
async function addColumnIfMissing(table: string, column: string, definition: string): Promise<void> {
  const columns = await db.pragma(table);
  if (!columns.some((col) => col.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function initializeSchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL UNIQUE,
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
      last_edited TEXT,
      subscribed_to_releases INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY,
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
      tarball_url TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT NOT NULL DEFAULT '📁',
      keywords TEXT,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      is_custom INTEGER DEFAULT 1
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

  await addColumnIfMissing('ai_configs', 'reasoning_effort', 'TEXT');
  await addColumnIfMissing('ai_configs', 'mimo_plan', 'TEXT');
  await addColumnIfMissing('repositories', 'category_locked', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('releases', 'zipball_url', 'TEXT');
  await addColumnIfMissing('releases', 'tarball_url', 'TEXT');
  await addColumnIfMissing('categories', 'description', 'TEXT');
  await addColumnIfMissing('categories', 'color', 'TEXT');
  await addColumnIfMissing('categories', 'sort_order', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('asset_filters', 'description', 'TEXT');
  await addColumnIfMissing('asset_filters', 'platform', 'TEXT');
  await addColumnIfMissing('asset_filters', 'sort_order', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('vector_search_configs', 'index_mode', "TEXT NOT NULL DEFAULT 'readme'");
  await addColumnIfMissing('vector_search_configs', 'readme_max_chars', 'INTEGER NOT NULL DEFAULT 6000');
  await addColumnIfMissing('vector_search_configs', 'search_threshold', 'REAL DEFAULT 0.35');
  await addColumnIfMissing('vector_search_configs', 'search_top_k', 'INTEGER DEFAULT 30');
  await addColumnIfMissing('vector_search_configs', 'enable_hyde', 'INTEGER DEFAULT 1');
  await addColumnIfMissing('vector_search_configs', 'enable_reranking', 'INTEGER DEFAULT 1');
  await addColumnIfMissing('vector_search_configs', 'embedding_format_version', 'INTEGER');
  await addColumnIfMissing('repositories', 'vector_indexed_at', 'TEXT');
  await addColumnIfMissing('repositories', 'license', 'TEXT');
  // 上一次向量索引时采用的 license 值（SPDX id / null）。用于增量谓词判断 license 是否
  // 变化：当期 license 与此值不一致时需重新索引，保证 license 变更能使向量元数据失效。
  await addColumnIfMissing('repositories', 'vector_indexed_license', 'TEXT');
}
