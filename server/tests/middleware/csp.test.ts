import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate DB before importing app modules that call getDb()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-csp-'));
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

describeIfDb('helmet CSP for browser-direct route mode', () => {
  let request: typeof import('supertest').default;
  let closeDb: () => void;
  let createApp: () => import('express').Express;

  beforeAll(async () => {
    const conn = await import('../../src/db/connection.js');
    const index = await import('../../src/index.js');
    const supertest = await import('supertest');

    request = supertest.default;
    closeDb = conn.closeDb;
    createApp = index.createApp;
  });

  afterAll(() => {
    try {
      closeDb();
    } catch {
      // already closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const cspOf = async (app: import('express').Express): Promise<string> => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    return response.headers['content-security-policy'] ?? '';
  };

  it('keeps default-src self and object-src none', async () => {
    const csp = await cspOf(createApp());
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it('allows browser-direct GitHub API and AI provider origins in connect-src', async () => {
    const csp = await cspOf(createApp());
    const connectSrc = csp.split(';').find((directive) => directive.trim().startsWith('connect-src')) ?? '';
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://api.github.com');
    expect(connectSrc).toContain('https://raw.githubusercontent.com');
    expect(connectSrc).toContain('https://gist.githubusercontent.com');
    expect(connectSrc).toContain('https://api.openai.com');
    expect(connectSrc).toContain('https://generativelanguage.googleapis.com');
  });

  it('allows remote avatar and README images via img-src', async () => {
    const csp = await cspOf(createApp());
    const imgSrc = csp.split(';').find((directive) => directive.trim().startsWith('img-src')) ?? '';
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('https:');
  });

  it('appends CSP_CONNECT_SRC extra origins', async () => {
    process.env.CSP_CONNECT_SRC = 'https://ai.example.com, https://worker.example.org';
    try {
      const csp = await cspOf(createApp());
      const connectSrc = csp.split(';').find((directive) => directive.trim().startsWith('connect-src')) ?? '';
      expect(connectSrc).toContain('https://ai.example.com');
      expect(connectSrc).toContain('https://worker.example.org');
    } finally {
      delete process.env.CSP_CONNECT_SRC;
    }
  });
});
