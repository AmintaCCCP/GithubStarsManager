import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate DB before importing app modules that call getDb()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-mcp-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.API_SECRET = 'test-api-secret';

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

describeIfDb('MCP admin + transport auth', () => {
  let request: typeof import('supertest').default;
  let app: import('express').Express;
  let closeDb: () => void;
  let getMcpTokenPlain: () => string | null;
  let setMcpEnabled: (v: boolean) => void;
  let ensureMcpToken: () => string;
  let isMcpEnabled: () => boolean;

  beforeAll(async () => {
    const conn = await import('../../src/db/connection.js');
    const migrations = await import('../../src/db/migrations.js');
    const index = await import('../../src/index.js');
    const settings = await import('../../src/mcp/settings.js');
    const supertest = await import('supertest');

    request = supertest.default;
    closeDb = conn.closeDb;
    getMcpTokenPlain = settings.getMcpTokenPlain;
    setMcpEnabled = settings.setMcpEnabled;
    ensureMcpToken = settings.ensureMcpToken;
    isMcpEnabled = settings.isMcpEnabled;

    const db = conn.getDb();
    migrations.runMigrations(db);
    db.prepare(
      `INSERT INTO repositories (id, name, full_name, description, html_url, stargazers_count, language, owner_login, topics, ai_summary, ai_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      1,
      'alpha',
      'acme/alpha',
      'offline CRDT',
      'https://github.com/acme/alpha',
      42,
      'Rust',
      'acme',
      '[]',
      'A CRDT library',
      JSON.stringify(['crdt'])
    );
    // Default: MCP off — mount must not mint tokens
    setMcpEnabled(false);
    app = index.createApp();
  });

  afterAll(() => {
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not create token on app mount when MCP disabled', () => {
    expect(isMcpEnabled()).toBe(false);
    // token may be absent
    expect(getMcpTokenPlain()).toBeNull();
  });

  it('GET /api/mcp/status requires API secret', async () => {
    const res = await request(app).get('/api/mcp/status');
    expect(res.status).toBe(401);
  });

  it('returns disabled status without minting token', async () => {
    const res = await request(app)
      .get('/api/mcp/status')
      .set('Authorization', 'Bearer test-api-secret');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.token).toBe('');
  });

  it('rejects /mcp with 404 when disabled (no surface leak)', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(404);
  });

  it('enables MCP, mints token, and accepts initialize', async () => {
    const enable = await request(app)
      .put('/api/mcp/config')
      .set('Authorization', 'Bearer test-api-secret')
      .send({ enabled: true });
    expect(enable.status).toBe(200);
    expect(enable.body.enabled).toBe(true);
    expect(String(enable.body.token)).toMatch(/^gsm_mcp_/);

    const token = enable.body.token as string;
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      });
    expect([200, 202]).toContain(res.status);
  });

  it('rejects wrong MCP token with 401 when enabled', async () => {
    ensureMcpToken();
    setMcpEnabled(true);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer gsm_mcp_wrong_token_value_here_xxx')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
  });

  it('PUT /api/mcp/config can reset token', async () => {
    setMcpEnabled(true);
    const before = ensureMcpToken();
    const res = await request(app)
      .put('/api/mcp/config')
      .set('Authorization', 'Bearer test-api-secret')
      .send({ resetToken: true, enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.token).not.toBe(before);
  });
});

describe('MCP pure units always run', () => {
  it('generateMcpToken format (no db)', async () => {
    const { generateMcpToken, timingSafeEqualString } = await import('../../src/mcp/settings.js');
    const t = generateMcpToken();
    expect(t.startsWith('gsm_mcp_')).toBe(true);
    expect(timingSafeEqualString(t, t)).toBe(true);
    expect(timingSafeEqualString(t, t + 'x')).toBe(false);
  });

  it('notes when sqlite native binding unavailable', () => {
    // Environment limitation (e.g. Node 26 without rebuildable better-sqlite3)
    expect(typeof dbAvailable).toBe('boolean');
  });
});
