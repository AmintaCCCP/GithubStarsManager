'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createDiagLogger, MAX_INGEST_BATCH } = require('./diagLogger');

/** Minimal in-memory fs standing in for node:fs (DI like desktopPrefs.test.js). */
function createFakeFs({ failAppend = false } = {}) {
  const files = new Map();
  const dirname = (p) => p.replace(/[/\\][^/\\]+$/, '');
  const basename = (p) => p.replace(/^.*[/\\]/, '');
  return {
    files,
    mkdirSync() { /* tree is implicit */ },
    readdirSync(dir) {
      const names = new Set();
      for (const key of files.keys()) {
        if (dirname(key) === dir) names.add(basename(key));
      }
      return Array.from(names);
    },
    statSync(p) {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return { size: Buffer.byteLength(files.get(p), 'utf8') };
    },
    accessSync(p) {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    },
    rmSync(p) { files.delete(p); },
    readFileSync(p) {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p);
    },
    appendFileSync(p, line) {
      if (failAppend) throw new Error('EIO: write failed');
      files.set(p, (files.get(p) || '') + line);
    },
  };
}

function createLogger({ clockMs = 1_700_000_000_000, ...options } = {}) {
  const fsImpl = createFakeFs(options.fsOverrides || {});
  const state = { nowMs: clockMs };
  const logger = createDiagLogger({
    logsDir: '/tmp/user-data/logs/diagnostics',
    fsImpl,
    now: () => new Date(state.nowMs),
    newId: (() => { let n = 0; return () => `id-${++n}`; })(),
    sessionId: 'session-fixed',
    ...options,
  });
  return { logger, fsImpl, state };
}

const dayFile = (ms) => {
  const d = new Date(ms);
  const day = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return path.join('/tmp/user-data/logs/diagnostics', `diagnostics-${day}.jsonl`);
};

async function readLines(fsImpl, filePath) {
  const content = fsImpl.files.get(filePath) || '';
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('diagLogger record/flush', () => {
  it('writes sanitized JSONL entries with sessionId to the daily file', async () => {
    const { logger, fsImpl } = createLogger();
    logger.record({ level: 'warn', module: 'electron.test', message: 'hello', data: { token: 'abcdefghijklmnopqrst' } });
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, 'warn');
    assert.equal(lines[0].source, 'main');
    assert.equal(lines[0].sessionId, 'session-fixed');
    assert.equal(lines[0].data.token, '***qrst');
    assert.equal(lines[0].message, 'hello');
    assert.ok(lines[0].id);
    assert.ok(lines[0].timestamp);
  });

  it('collapses repeated module+level+message within the window into one repeatCount entry', async () => {
    const { logger, fsImpl } = createLogger();
    for (let i = 0; i < 5; i++) {
      logger.record({ level: 'info', module: 'm', message: 'same text' });
      // 1s apart, inside the same 10s window
      await new Promise((r) => setTimeout(r, 1));
    }
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].repeatCount, 5);
    assert.equal(lines[0].message, 'same text');
  });

  it('writes error entries immediately without aggregation', async () => {
    const { logger, fsImpl } = createLogger();
    logger.record({ level: 'error', module: 'm', message: 'boom' });
    logger.record({ level: 'error', module: 'm', message: 'boom' });
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    assert.equal(lines.length, 2);
    assert.ok(!('repeatCount' in lines[0]));
  });

  it('records an expired window as its own entry when the same key repeats later', async () => {
    const { logger, fsImpl, state } = createLogger();
    logger.record({ level: 'info', module: 'm', message: 'tick' });
    state.nowMs += 20_000;
    logger.record({ level: 'info', module: 'm', message: 'tick' });
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    // First held window flushed on repeat-after-expiry, second window flushed by flush()
    assert.equal(lines.length, 2);
  });

  it('never throws when recording garbage', () => {
    const { logger } = createLogger();
    assert.doesNotThrow(() => logger.record(null));
    assert.doesNotThrow(() => logger.record(undefined));
    assert.doesNotThrow(() => logger.record({ level: 'nope', module: 42, message: {} }));
  });
});

describe('diagLogger ingestRenderer', () => {
  it('stores frontend entries without second-stage aggregation', async () => {
    const { logger, fsImpl } = createLogger();
    const entry = () => ({
      id: 'x', timestamp: new Date(1_700_000_000_000).toISOString(), level: 'warn',
      module: 'ui', message: 'same', source: 'frontend', repeatCount: 3,
    });
    const result = logger.ingestRenderer([entry(), entry()]);
    assert.equal(result.success, true);
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].source, 'frontend');
    assert.equal(lines[0].repeatCount, 3);
  });

  it('caps batch size and re-sanitizes entries at write time', async () => {
    const { logger, fsImpl } = createLogger();
    const batch = Array.from({ length: MAX_INGEST_BATCH + 50 }, (_, i) => ({
      id: `e${i}`, timestamp: new Date().toISOString(), level: 'error', module: 'ui',
      message: `ghp_${'b'.repeat(36)}`, source: 'frontend',
    }));
    const result = logger.ingestRenderer(batch);
    assert.equal(result.success, true);
    assert.equal(result.accepted, MAX_INGEST_BATCH);
    await logger.flush();
    const lines = await readLines(fsImpl, dayFile(1_700_000_000_000));
    assert.equal(lines.length, MAX_INGEST_BATCH);
    assert.equal(lines[0].message, '***bbbb');
  });

  it('rejects non-array payloads', () => {
    const { logger } = createLogger();
    assert.equal(logger.ingestRenderer('nope').success, false);
    assert.equal(logger.ingestRenderer(null).success, false);
  });
});

describe('diagLogger readTail', () => {
  it('returns entries chronologically with filters applied', async () => {
    const { logger } = createLogger();
    logger.record({ level: 'error', module: 'a', message: 'first' });
    logger.record({ level: 'error', module: 'b', message: 'second' });
    logger.record({ level: 'info', module: 'c', message: 'third' });
    await logger.flush();
    const all = await logger.readTail({});
    assert.equal(all.length, 3);
    assert.equal(all[0].message, 'first');
    assert.equal(all[2].message, 'third');
    const errorsOnly = await logger.readTail({ level: 'error' });
    assert.equal(errorsOnly.length, 2);
    const limited = await logger.readTail({ limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].message, 'third');
  });

  it('filters by source', async () => {
    const { logger } = createLogger();
    logger.record({ level: 'warn', module: 'a', message: 'main entry' });
    logger.ingestRenderer([{ id: '1', timestamp: new Date().toISOString(), level: 'warn', module: 'ui', message: 'fe entry', source: 'frontend' }]);
    await logger.flush();
    const mainOnly = await logger.readTail({ sources: ['main'] });
    assert.equal(mainOnly.length, 1);
    assert.equal(mainOnly[0].message, 'main entry');
  });
});

describe('diagLogger budgets', () => {
  it('stops writing past the daily byte budget, records a marker, and serves overflow from memory', async () => {
    const { logger } = createLogger({ maxFileBytes: 400 });
    for (let i = 0; i < 10; i++) {
      logger.record({ level: 'error', module: 'm', message: `error number ${i} with some length to it` });
    }
    await logger.flush();
    const tail = await logger.readTail({});
    assert.ok(tail.some((e) => e.message.includes('budget reached')), 'marker entry present');
    assert.ok(logger.stats().saturated);
    // Entries beyond saturation still readable from the memory ring
    assert.ok(logger.stats().memoryRing > 0);
    const messages = tail.map((e) => e.message);
    assert.ok(messages.includes('error number 9 with some length to it'));
  });

  it('degrades to the memory ring when disk writes fail', async () => {
    const { logger, fsImpl } = createLogger({ fsOverrides: { failAppend: true } });
    logger.record({ level: 'error', module: 'm', message: 'no disk' });
    await logger.flush();
    assert.ok(logger.stats().degraded);
    assert.ok(fsImpl.files.size === 0);
    const tail = await logger.readTail({});
    assert.equal(tail.length, 1);
    assert.equal(tail[0].message, 'no disk');
  });

  it('deletes expired day files and enforces the total byte budget on init', async () => {
    const todayMs = 1_700_000_000_000;
    const { logger, fsImpl } = createLogger({
      clockMs: todayMs,
      maxFiles: 3,
      maxTotalBytes: 10,
    });
    const dir = path.dirname(dayFile(todayMs));
    const dayFor = (offsetDays) => {
      const d = new Date(todayMs - offsetDays * 86_400_000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    };
    fsImpl.files.set(path.join(dir, `diagnostics-${dayFor(1)}.jsonl`), '{"timestamp":"x"}\n'.repeat(3));
    fsImpl.files.set(path.join(dir, `diagnostics-${dayFor(5)}.jsonl`), '{"timestamp":"old"}\n');
    logger.record({ level: 'error', module: 'm', message: 'boot' });
    await logger.flush();
    assert.equal(fsImpl.files.has(path.join(dir, `diagnostics-${dayFor(5)}.jsonl`)), false, 'expired file removed');
    // Total budget (10 bytes) forces removal of the other day files too
    assert.equal(fsImpl.files.has(path.join(dir, `diagnostics-${dayFor(1)}.jsonl`)), false, 'over-budget file removed');
  });
});
