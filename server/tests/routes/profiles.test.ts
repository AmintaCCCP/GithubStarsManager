import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate DB before importing app modules that call getDb()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-profiles-'));
const defaultDbPath = path.join(tmpDir, 'data.db');
const profilesDir = path.join(tmpDir, 'profiles');

process.env.DB_PATH = defaultDbPath;
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
process.env.API_SECRET = 'test-profiles-secret';

async function canOpenSqlite(): Promise<boolean> {
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await canOpenSqlite();
const describeIfDb = dbAvailable ? describe : describe.skip;

const AUTH_HEADER = 'Bearer test-profiles-secret';

function makeRepo(id: number, owner: string, name: string) {
  return {
    id,
    name,
    full_name: `${owner}/${name}`,
    description: `${name} description`,
    html_url: `https://github.com/${owner}/${name}`,
    stargazers_count: id * 10,
    language: 'TypeScript',
    owner: { login: owner, avatar_url: `https://avatars.githubusercontent.com/u/${id}` },
    topics: ['test'],
  };
}

describeIfDb('Multi-profile SQLite isolation & profile management', () => {
  let request: typeof import('supertest').default;
  let app: import('express').Express;
  let conn: typeof import('../../src/db/connection.js');

  beforeAll(async () => {
    conn = await import('../../src/db/connection.js');
    const migrations = await import('../../src/db/migrations.js');
    const index = await import('../../src/index.js');
    const supertest = await import('supertest');

    request = supertest.default;

    const db = conn.getDb();
    migrations.runMigrations(db);
    app = index.createApp();
  });

  afterAll(() => {
    try {
      conn.closeDb();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/health reports profilesSupported: true without auth and without creating profile DBs', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('X-GSM-Profile', 'p_health_probe')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.profilesSupported).toBe(true);
    expect(fs.existsSync(path.join(profilesDir, 'p_health_probe.db'))).toBe(false);
  });

  it('allows X-GSM-Profile in CORS preflight responses', async () => {
    const res = await request(app)
      .options('/api/repositories')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization, X-GSM-Profile')
      .expect(204);

    const allowHeaders = String(res.headers['access-control-allow-headers'] ?? '');
    expect(allowHeaders.toLowerCase()).toContain('x-gsm-profile');
  });

  it('routes headerless and X-GSM-Profile: default to data.db untouched', async () => {
    await request(app)
      .put('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .send({
        repositories: [makeRepo(1, 'alice', 'default-repo')],
        isFullSync: true,
      })
      .expect(200);

    // Headerless GET sees the repo
    const resNoHeader = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(resNoHeader.body.total).toBe(1);
    expect(resNoHeader.body.repositories[0].full_name).toBe('alice/default-repo');

    // Explicit 'default' header sees the exact same data.db
    const resDefault = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'default')
      .expect(200);
    expect(resDefault.body.total).toBe(1);
    expect(resDefault.body.repositories[0].full_name).toBe('alice/default-repo');

    // Empty header also routes to default
    const resEmpty = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', '')
      .expect(200);
    expect(resEmpty.body.total).toBe(1);

    // No profiles/ directory created yet
    expect(fs.existsSync(profilesDir)).toBe(false);
  });

  it('isolates repositories, settings, and isFullSync between default and p_123', async () => {
    // Write to p_123 with isFullSync: true
    await request(app)
      .put('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .send({
        repositories: [makeRepo(200, 'bob', 'bob-repo-1'), makeRepo(201, 'bob', 'bob-repo-2')],
        isFullSync: true,
      })
      .expect(200);

    // Profile DB file should exist under profiles/p_123.db
    expect(fs.existsSync(path.join(profilesDir, 'p_123.db'))).toBe(true);

    // p_123 only sees bob's repos
    const bobRepos = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .expect(200);
    expect(bobRepos.body.total).toBe(2);
    expect(bobRepos.body.repositories.map((r: { full_name: string }) => r.full_name).sort()).toEqual([
      'bob/bob-repo-1',
      'bob/bob-repo-2',
    ]);

    // Default data.db is completely unaffected by p_123's isFullSync
    const aliceRepos = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(aliceRepos.body.total).toBe(1);
    expect(aliceRepos.body.repositories[0].full_name).toBe('alice/default-repo');

    // Full sync on default does NOT affect p_123
    await request(app)
      .put('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .send({
        repositories: [makeRepo(2, 'alice', 'alice-new-repo')],
        isFullSync: true,
      })
      .expect(200);

    const bobAfterAliceSync = await request(app)
      .get('/api/repositories')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .expect(200);
    expect(bobAfterAliceSync.body.total).toBe(2);

    // Settings isolation
    await request(app)
      .put('/api/settings')
      .set('Authorization', AUTH_HEADER)
      .send({
        theme: 'light',
        github_token: 'test-token-default-alice-1234',
      })
      .expect(200);

    await request(app)
      .put('/api/settings')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .send({
        theme: 'dark',
        github_token: 'test-token-profile-bob-5678',
        github_user: {
          login: 'bob',
          avatar_url: 'https://avatars.githubusercontent.com/u/123',
          name: 'Bob Builder',
        },
      })
      .expect(200);

    const defaultSettings = await request(app)
      .get('/api/settings')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(defaultSettings.body.theme).toBe('light');

    const profileSettings = await request(app)
      .get('/api/settings')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .expect(200);
    expect(profileSettings.body.theme).toBe('dark');
  });

  it('POST /api/sync/auth respects X-GSM-Profile header', async () => {
    const defaultAuth = await request(app)
      .post('/api/sync/auth')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(defaultAuth.body.github_token).toBe('test-token-default-alice-1234');

    const profileAuth = await request(app)
      .post('/api/sync/auth')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .expect(200);
    expect(profileAuth.body.github_token).toBe('test-token-profile-bob-5678');

    // A fresh profile with no token saved returns null
    const emptyProfileAuth = await request(app)
      .post('/api/sync/auth')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_empty_profile')
      .expect(200);
    expect(emptyProfileAuth.body.github_token).toBeNull();
  });

  it('rejects invalid X-GSM-Profile headers with 400 Bad Request', async () => {
    const invalidHeaders = [
      '../evil',
      'p_../evil',
      'p_foo/bar',
      'P_123',
      '123456',
      'p_',
      'p_space here',
      'p_semi;colon',
      `p_${'a'.repeat(33)}`,
    ];

    for (const bad of invalidHeaders) {
      const res = await request(app)
        .get('/api/repositories')
        .set('Authorization', AUTH_HEADER)
        .set('X-GSM-Profile', bad)
        .expect(400);

      expect(res.body.error).toBe('Invalid X-GSM-Profile header');
    }
  });

  it('GET /api/profiles requires auth and lists created profiles with optional metadata', async () => {
    await request(app).get('/api/profiles').expect(401);

    const res = await request(app)
      .get('/api/profiles')
      .set('Authorization', AUTH_HEADER)
      .expect(200);

    expect(Array.isArray(res.body.profiles)).toBe(true);
    const byId = new Map(
      res.body.profiles.map((p: { id: string; login?: string; avatarUrl?: string; name?: string }) => [p.id, p])
    );

    expect(byId.get('p_123')).toEqual({
      id: 'p_123',
      login: 'bob',
      avatarUrl: 'https://avatars.githubusercontent.com/u/123',
      name: 'Bob Builder',
    });
    expect(byId.get('p_empty_profile')).toEqual({ id: 'p_empty_profile' });
  });

  it('DELETE /api/profiles/:id removes DB files and rejects default or invalid IDs', async () => {
    await request(app).delete('/api/profiles/p_empty_profile').expect(401);

    // Reject 'default' and invalid IDs
    for (const invalid of ['default', 'P_123', 'not_a_profile', `p_${'x'.repeat(33)}`]) {
      await request(app)
        .delete(`/api/profiles/${encodeURIComponent(invalid)}`)
        .set('Authorization', AUTH_HEADER)
        .expect(400);
    }

    // Delete existing profile
    const targetDb = path.join(profilesDir, 'p_empty_profile.db');
    expect(fs.existsSync(targetDb)).toBe(true);

    const delRes = await request(app)
      .delete('/api/profiles/p_empty_profile')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(delRes.body).toEqual({ deleted: true });

    expect(fs.existsSync(targetDb)).toBe(false);
    expect(fs.existsSync(`${targetDb}-wal`)).toBe(false);
    expect(fs.existsSync(`${targetDb}-shm`)).toBe(false);

    // No longer listed
    const listRes = await request(app)
      .get('/api/profiles')
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(listRes.body.profiles.some((p: { id: string }) => p.id === 'p_empty_profile')).toBe(false);
  });

  it('bounds open profile DB handles to 16 via LRU eviction and closeDb() closes all handles', () => {
    // Open 20 distinct profiles
    for (let i = 1; i <= 20; i++) {
      const id = `p_lru_${i}`;
      conn.runWithProfileDb(id, () => {
        const db = conn.getDb();
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('idx', String(i));
      });
    }

    expect(conn.getOpenProfileCount()).toBeLessThanOrEqual(16);

    // Evicted profile (p_lru_1) can still be transparently re-opened with its persisted data intact
    const value = conn.runWithProfileDb('p_lru_1', () => {
      const row = conn.getDb().prepare('SELECT value FROM settings WHERE key = ?').get('idx') as { value: string };
      return row.value;
    });
    expect(value).toBe('1');
    expect(conn.getOpenProfileCount()).toBeLessThanOrEqual(16);

    // closeDb() closes both default DB and all pooled profile DBs
    conn.closeDb();
    expect(conn.getOpenProfileCount()).toBe(0);
  });

  it('does not create phantom profile DB files on /api/profiles* requests with X-GSM-Profile', async () => {
    const ghostDb = path.join(profilesDir, 'p_ghost.db');
    expect(fs.existsSync(ghostDb)).toBe(false);

    await request(app)
      .get('/api/profiles')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_ghost')
      .expect(200);

    expect(fs.existsSync(ghostDb)).toBe(false);

    await request(app)
      .delete('/api/profiles/p_nonexistent')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_ghost')
      .expect(200);

    expect(fs.existsSync(ghostDb)).toBe(false);
  });

  it('returns 409 PROFILE_IN_USE on DELETE while in-flight and skips active handles during LRU eviction', async () => {
    const activeId = 'p_inflight_guard';
    const activeDb = conn.acquireProfileDb(activeId);
    try {
      expect(conn.getProfileRefCount(activeId)).toBe(1);

      // Concurrent delete must fail with 409 Conflict instead of closing active handle
      const conflictRes = await request(app)
        .delete(`/api/profiles/${activeId}`)
        .set('Authorization', AUTH_HEADER)
        .expect(409);
      expect(conflictRes.body.code).toBe('PROFILE_IN_USE');
      expect(activeDb.open).toBe(true);

      // Opening 20 other profiles must NOT evict or close the in-flight handle
      for (let i = 1; i <= 20; i++) {
        conn.runWithProfileDb(`p_evict_${i}`, () => {
          conn.getDb().prepare('SELECT 1').get();
        });
      }
      expect(activeDb.open).toBe(true);
      expect(() => activeDb.prepare('SELECT 1').get()).not.toThrow();
    } finally {
      conn.releaseProfileDb(activeId);
    }

    expect(conn.getProfileRefCount(activeId)).toBe(0);
    await request(app)
      .delete(`/api/profiles/${activeId}`)
      .set('Authorization', AUTH_HEADER)
      .expect(200);
    expect(fs.existsSync(path.join(profilesDir, `${activeId}.db`))).toBe(false);
  });

  it('reclaims excess idle profile DB handles back to 16 after a >16 concurrent burst finishes', () => {
    const burstIds = Array.from({ length: 18 }, (_, idx) => `p_burst_${idx + 1}`);
    for (const id of burstIds) {
      conn.acquireProfileDb(id);
    }
    expect(conn.getOpenProfileCount()).toBeGreaterThanOrEqual(18);

    for (const id of burstIds) {
      conn.releaseProfileDb(id);
    }
    expect(conn.getOpenProfileCount()).toBeLessThanOrEqual(16);
  });

  it('isolates MCP endpoints and tokens per profile without creating phantom DBs', async () => {
    // Enable MCP only on p_123 (default remains disabled)
    const cfgRes = await request(app)
      .put('/api/mcp/config')
      .set('Authorization', AUTH_HEADER)
      .set('X-GSM-Profile', 'p_123')
      .send({ enabled: true })
      .expect(200);

    expect(cfgRes.body.enabled).toBe(true);
    expect(typeof cfgRes.body.token).toBe('string');
    expect(cfgRes.body.token.length).toBeGreaterThan(0);
    expect(cfgRes.body.endpoints.streamableHttp).toBe('/mcp?profile=p_123');
    expect(cfgRes.body.endpoints.sse).toBe('/mcp/sse?profile=p_123');

    // Default /mcp remains disabled (404)
    await request(app)
      .get('/mcp')
      .set('Authorization', `Bearer ${cfgRes.body.token}`)
      .expect(404);

    // Secondary /mcp?profile=p_123 authenticates with p_123's token (GET returns 405 after auth passes)
    await request(app)
      .get('/mcp?profile=p_123')
      .set('Authorization', `Bearer ${cfgRes.body.token}`)
      .expect(405);

    // Unknown profile returns 404 without creating a phantom DB file
    const phantomDb = path.join(profilesDir, 'p_mcp_phantom.db');
    await request(app)
      .get('/mcp?profile=p_mcp_phantom')
      .set('Authorization', `Bearer ${cfgRes.body.token}`)
      .expect(404);
    expect(fs.existsSync(phantomDb)).toBe(false);
  });
});
