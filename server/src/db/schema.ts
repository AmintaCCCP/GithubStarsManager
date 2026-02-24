import type Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
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
      is_read INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📁',
      keywords TEXT,
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
      concurrency INTEGER DEFAULT 1
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
      keywords TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
