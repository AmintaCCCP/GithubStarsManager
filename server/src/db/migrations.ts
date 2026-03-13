import type Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';

const migrations: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    initializeSchema(db);
  },
  2: (db) => {
    // 1. Create the new schema tables
    initializeSchema(db);

    // 2. Ensure default user exists if there are repositories but no users
    const hasRepos = db.prepare('SELECT COUNT(*) as c FROM repositories').get() as { c: number };
    const hasUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    
    let defaultUserId = 1;
    if (hasRepos.c > 0 && hasUsers.c === 0) {
      // Create a default SuperAdmin if migrating existing instance
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, role)
        VALUES ('admin', 'CHANGE_ME', 'SuperAdmin')
      `).run();
      defaultUserId = result.lastInsertRowid as number;
    }

    // 3. Migrate existing data to have user_id if they don't have it defined properly
    // Note: Since we used 'initializeSchema', tables might be fresh ones with new columns 
    // depending on SQLite's ALTER abilities. Actually, since SQLite doesn't support adding
    // columns with NOT NULL constraints trivially without a default, we should ideally recreate 
    // tables or trust that initialize schema handles the 'CREATE TABLE IF NOT EXISTS' nicely 
    // but wouldn't alter existing. Let's do a safe alter table for existing users:
    
    const tables = ['repositories', 'releases', 'categories', 'ai_configs', 'webdav_configs', 'asset_filters', 'settings'];
    
    for (const table of tables) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER NOT NULL DEFAULT ${defaultUserId}`);
      } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
          console.error(`Error adding user_id to ${table}:`, e.message);
        }
      }
    }
  },
  3: (db) => {
    try {
      db.exec('ALTER TABLE settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime(\'now\'))');
    } catch (e: any) {
      if (!e.message.includes('duplicate column name')) {
        console.error('Error adding updated_at to settings:', e.message);
      }
    }
  },
  4: (db) => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          task_type TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          cron_expression TEXT NOT NULL,
          last_run TEXT,
          next_run TEXT,
          UNIQUE(user_id, task_type)
        );

        CREATE TABLE IF NOT EXISTS notification_preferences (
          user_id INTEGER PRIMARY KEY,
          notify_new_release INTEGER DEFAULT 1,
          notify_star_added INTEGER DEFAULT 1,
          notify_star_removed INTEGER DEFAULT 1,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
      if (tables.length > 0) {
        const users = db.prepare('SELECT id FROM users').all() as { id: number }[];
        const defaultTasks = [
          { task_type: 'sync_stars', cron_expression: '0 */6 * * *' },
          { task_type: 'check_releases', cron_expression: '0 * * * *' }
        ];
        
        const insertTask = db.prepare('INSERT OR IGNORE INTO scheduled_tasks (id, user_id, task_type, enabled, cron_expression) VALUES (?, ?, ?, 1, ?)');
        const insertPref = db.prepare('INSERT OR IGNORE INTO notification_preferences (user_id, notify_new_release, notify_star_added, notify_star_removed) VALUES (?, 1, 1, 1)');
        
        for (const user of users) {
          insertPref.run(user.id);
          for (const task of defaultTasks) {
            insertTask.run(`${user.id}_${task.task_type}`, user.id, task.task_type, task.cron_expression);
          }
        }
      }
    } catch (e: any) {
      console.error('Error in migration v4:', e.message);
    }
  },
  5: (db) => {
    try {
      db.exec(`
        ALTER TABLE users ADD COLUMN email TEXT;
        ALTER TABLE users ADD COLUMN display_name TEXT;
        ALTER TABLE users ADD COLUMN avatar_url TEXT;
      `);
      
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);
    } catch (e: any) {
      if (!e.message.includes('duplicate column name')) {
        console.error('Error in migration v5:', e.message);
      }
    }
  }
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
        console.log(`Applying migration v${v}...`);
        migration(db);
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v);
        console.log(`Migration v${v} applied.`);
      }
    }
  });

  applyMigration();
}
