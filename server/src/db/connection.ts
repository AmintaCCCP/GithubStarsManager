import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import { initializeSchema } from './schema.js';
import { runMigrations } from './migrations.js';

export const PROFILE_ID_REGEX = /^p_[a-z0-9_-]{1,32}$/;
const MAX_PROFILE_DBS = 16;

export interface ProfileSummary {
  id: string;
  login?: string;
  avatarUrl?: string;
  name?: string;
}

export class ProfileInUseError extends Error {
  readonly code = 'PROFILE_IN_USE';
  constructor(profileId: string) {
    super(`Profile ${profileId} is currently in use`);
    this.name = 'ProfileInUseError';
  }
}

const dbContext = new AsyncLocalStorage<Database.Database>();
let defaultDb: Database.Database | null = null;
const profileDbPool = new Map<string, Database.Database>();
const profileRefCounts = new Map<string, number>();

export function isValidProfileId(profileId: string): boolean {
  return PROFILE_ID_REGEX.test(profileId);
}

export function getProfilesDir(): string {
  return path.join(path.dirname(config.dbPath), 'profiles');
}

function resolveProfileDbPath(profileId: string): string {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Invalid profile ID: ${profileId}`);
  }
  const profilesDir = path.resolve(getProfilesDir());
  const resolved = path.resolve(profilesDir, `${profileId}.db`);
  if (!resolved.startsWith(`${profilesDir}${path.sep}`)) {
    throw new Error(`Invalid profile DB path for ID: ${profileId}`);
  }
  return resolved;
}

export function profileDbExists(profileId: string): boolean {
  if (!isValidProfileId(profileId)) return false;
  if (profileDbPool.has(profileId)) return true;
  try {
    return fs.existsSync(resolveProfileDbPath(profileId));
  } catch {
    return false;
  }
}

function evictIdleProfileDbs(maxSize: number): void {
  while (profileDbPool.size > maxSize) {
    let evictKey: string | undefined;
    for (const key of profileDbPool.keys()) {
      if ((profileRefCounts.get(key) ?? 0) === 0) {
        evictKey = key;
        break;
      }
    }
    if (evictKey === undefined) {
      break;
    }
    const oldestDb = profileDbPool.get(evictKey);
    profileDbPool.delete(evictKey);
    if (oldestDb && oldestDb.open) {
      try {
        oldestDb.close();
      } catch (closeErr) {
        logger.warn('db.connection', `Failed to close evicted profile DB ${evictKey}`, closeErr);
      }
    }
  }
}

function openSqliteFile(filePath: string): Database.Database {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const instance = new Database(filePath);
  try {
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    // 设置超时时间为5秒，防止数据库锁定
    instance.pragma('busy_timeout = 5000');
    return instance;
  } catch (error) {
    try {
      if (instance.open) {
        instance.close();
      }
    } catch (closeErr) {
      logger.warn('db.connection', `Failed to close SQLite handle after pragma error (${filePath})`, closeErr);
    }
    throw error;
  }
}

export function getDefaultDb(): Database.Database {
  if (defaultDb && defaultDb.open) return defaultDb;

  try {
    defaultDb = openSqliteFile(config.dbPath);
    return defaultDb;
  } catch (error) {
    logger.errorFromError('db.connection', 'Failed to initialize database', error);
    throw new Error('Database initialization failed');
  }
}

function getProfileDb(profileId: string): Database.Database {
  const dbPath = resolveProfileDbPath(profileId);

  const cached = profileDbPool.get(profileId);
  if (cached) {
    if (cached.open) {
      // Refresh LRU recency
      profileDbPool.delete(profileId);
      profileDbPool.set(profileId, cached);
      return cached;
    }
    profileDbPool.delete(profileId);
  }

  // Evict least-recently-used idle handles if at capacity.
  // Never evict a handle that currently has in-flight requests (refCount > 0).
  evictIdleProfileDbs(MAX_PROFILE_DBS - 1);

  let instance: Database.Database | null = null;
  try {
    instance = openSqliteFile(dbPath);
    initializeSchema(instance);
    runMigrations(instance);
    profileDbPool.set(profileId, instance);
    return instance;
  } catch (error) {
    if (instance && instance.open) {
      try {
        instance.close();
      } catch (closeErr) {
        logger.warn('db.connection', `Failed to close profile DB ${profileId} after init error`, closeErr);
      }
    }
    logger.errorFromError('db.connection', `Failed to initialize profile database ${profileId}`, error);
    throw new Error('Profile database initialization failed');
  }
}

export function getDb(): Database.Database {
  return dbContext.getStore() ?? getDefaultDb();
}

export function acquireProfileDb(profileId: string): Database.Database {
  const profileDb = getProfileDb(profileId);
  profileRefCounts.set(profileId, (profileRefCounts.get(profileId) ?? 0) + 1);
  return profileDb;
}

export function releaseProfileDb(profileId: string): void {
  const current = profileRefCounts.get(profileId) ?? 0;
  if (current <= 1) {
    profileRefCounts.delete(profileId);
    if (profileDbPool.size > MAX_PROFILE_DBS) {
      evictIdleProfileDbs(MAX_PROFILE_DBS);
    }
  } else {
    profileRefCounts.set(profileId, current - 1);
  }
}

export function getProfileRefCount(profileId: string): number {
  return profileRefCounts.get(profileId) ?? 0;
}

export function runWithDbInstance<T>(db: Database.Database, fn: () => T): T {
  return dbContext.run(db, fn);
}

export function runWithProfileDb<T>(profileId: string | null | undefined, fn: () => T): T {
  if (!profileId || profileId === 'default') {
    return fn();
  }
  const profileDb = acquireProfileDb(profileId);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseProfileDb(profileId);
  };
  try {
    const result = dbContext.run(profileDb, fn);
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
      return (result as unknown as Promise<unknown>).finally(release) as unknown as T;
    }
    release();
    return result;
  } catch (err) {
    release();
    throw err;
  }
}

function extractProfileMetadataFromDb(db: Database.Database): Omit<ProfileSummary, 'id'> {
  const meta: Omit<ProfileSummary, 'id'> = {};
  try {
    const rows = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN (
          'github_user', 'user', 'profile_user', 'profile_meta',
          'github_login', 'github_avatar_url', 'github_name'
        )`
      )
      .all() as Array<{ key: string; value: string | null }>;

    const byKey = new Map<string, string>();
    for (const row of rows) {
      if (typeof row.value === 'string' && row.value.trim()) {
        byKey.set(row.key, row.value);
      }
    }

    for (const jsonKey of ['github_user', 'user', 'profile_user', 'profile_meta']) {
      const raw = byKey.get(jsonKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          if (!meta.login && typeof parsed.login === 'string' && parsed.login) {
            meta.login = parsed.login;
          }
          const avatar = parsed.avatarUrl ?? parsed.avatar_url;
          if (!meta.avatarUrl && typeof avatar === 'string' && avatar) {
            meta.avatarUrl = avatar;
          }
          if (!meta.name && typeof parsed.name === 'string' && parsed.name) {
            meta.name = parsed.name;
          }
        }
      } catch {
        // Ignore malformed JSON values
      }
    }

    if (!meta.login && byKey.has('github_login')) {
      meta.login = byKey.get('github_login');
    }
    if (!meta.avatarUrl && byKey.has('github_avatar_url')) {
      meta.avatarUrl = byKey.get('github_avatar_url');
    }
    if (!meta.name && byKey.has('github_name')) {
      meta.name = byKey.get('github_name');
    }
  } catch {
    // Table may not exist yet or DB may be unreadable — return empty metadata gracefully
  }
  return meta;
}

export function listProfiles(): ProfileSummary[] {
  const profilesDir = getProfilesDir();
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(profilesDir);
  } catch {
    return [];
  }

  const profileIds = entries
    .filter((entry) => entry.endsWith('.db'))
    .map((entry) => entry.slice(0, -3))
    .filter((id) => isValidProfileId(id))
    .sort();

  return profileIds.map((id) => {
    const cached = profileDbPool.get(id);
    if (cached && cached.open) {
      return { id, ...extractProfileMetadataFromDb(cached) };
    }

    const dbPath = resolveProfileDbPath(id);
    let tempDb: Database.Database | null = null;
    try {
      tempDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      return { id, ...extractProfileMetadataFromDb(tempDb) };
    } catch {
      return { id };
    } finally {
      if (tempDb && tempDb.open) {
        try {
          tempDb.close();
        } catch {
          // Ignore close errors on temporary readonly handle
        }
      }
    }
  });
}

export function deleteProfileDb(profileId: string): boolean {
  const dbPath = resolveProfileDbPath(profileId);

  if ((profileRefCounts.get(profileId) ?? 0) > 0) {
    throw new ProfileInUseError(profileId);
  }

  const cached = profileDbPool.get(profileId);
  if (cached) {
    profileDbPool.delete(profileId);
    if (cached.open) {
      try {
        cached.close();
      } catch (closeErr) {
        logger.warn('db.connection', `Failed to close profile DB ${profileId} before delete`, closeErr);
      }
    }
  }

  let existed = false;
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      existed = true;
      fs.rmSync(target, { force: true });
    }
  }
  return existed;
}

export function getOpenProfileCount(): number {
  return profileDbPool.size;
}

export function closeDb(): void {
  if (defaultDb) {
    try {
      if (defaultDb.open) {
        defaultDb.close();
      }
    } catch (closeErr) {
      logger.warn('db.connection', 'Failed to close default DB', closeErr);
    }
    defaultDb = null;
  }

  for (const [profileId, instance] of profileDbPool.entries()) {
    try {
      if (instance.open) {
        instance.close();
      }
    } catch (closeErr) {
      logger.warn('db.connection', `Failed to close profile DB ${profileId}`, closeErr);
    }
  }
  profileDbPool.clear();
  profileRefCounts.clear();
}
