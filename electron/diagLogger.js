'use strict';

/**
 * Diagnostics disk kernel — the single JSONL journal for everything the
 * renderer bridge and the main process record.
 *
 * File layout: `<logsDir>/diagnostics-YYYY-MM-DD.jsonl`, one entry per line,
 * rotated per day. Budgets: maxFileBytes per day file (5MB normal / 20MB debug),
 * maxTotalBytes across the directory (20MB / 40MB), maxFiles days retained.
 * Startup and rotation cleanup removes over-budget files; every cleanup or
 * write failure degrades silently to an in-memory ring — never throws into
 * business code paths, never blocks startup or quit.
 *
 * Flood control: main-process entries (source !== 'frontend') with identical
 * module+level+message collapse into one entry with repeatCount per 10s window
 * (retry storms / offline polling stop flooding the journal). Renderer batches
 * arrive already aggregated and are ingested verbatim — no double counting.
 * `error`-level entries bypass aggregation entirely: crash evidence must hit
 * disk immediately.
 *
 * Dependency injection (fs/clock/uuid/sanitizer) keeps this unit-testable the
 * same way desktopPrefs.js is.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const redact = require('./redact');

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const REPEAT_WINDOW_MS = 10_000;
/** Max entries accepted per renderer batch (bridge flushes at 32 / 2s). */
const MAX_INGEST_BATCH = 200;
/** In-memory fallback ring used when disk writes fail. */
const MEMORY_RING_SIZE = 1000;
const MODULE_MAX_LENGTH = 200;
const MESSAGE_MAX_LENGTH = 4000;
const DATA_MAX_JSON_LENGTH = 32 * 1024;
const FILENAME_RE = /^diagnostics-(\d{4}-\d{2}-\d{2})\.jsonl$/;

function isoDay(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function resolveBudget(value, fallback) {
  if (typeof value === 'function') {
    try {
      const resolved = Number(value());
      return Number.isFinite(resolved) && resolved > 0 ? resolved : fallback;
    } catch {
      return fallback;
    }
  }
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createDiagLogger({
  logsDir,
  fsImpl = fs,
  now = () => new Date(),
  newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  sessionId = randomUUID(),
  maxFileBytes = 5 * 1024 * 1024,
  maxTotalBytes = 20 * 1024 * 1024,
  maxFiles = 7,
  source = 'main',
  sanitizer = redact,
  aggregateOwnEntries = true,
} = {}) {
  if (typeof logsDir !== 'string' || logsDir.trim() === '') {
    throw new TypeError('diagLogger requires a logsDir');
  }

  let initialized = false;
  let degraded = false;
  let saturated = false;
  let currentDay = null;
  let currentFilePath = null;
  let currentFileSize = 0;
  const memoryRing = [];
  /** key -> { entry, count, flushAt, timer } for own-entry flood aggregation */
  const aggregations = new Map();

  const filePathFor = (day) => path.join(logsDir, `diagnostics-${day}.jsonl`);

  function pushMemoryRing(entry) {
    memoryRing.push(entry);
    if (memoryRing.length > MEMORY_RING_SIZE) memoryRing.shift();
  }

  function ensureDir() {
    fsImpl.mkdirSync(logsDir, { recursive: true });
  }

  /** Startup/rotation housekeeping. Failure only degrades to memory. */
  function cleanupExpired() {
    try {
      const cutoff = new Date(now().getTime() - (maxFiles - 1) * 86_400_000);
      const cutoffDay = isoDay(cutoff);
      const files = [];
      for (const name of fsImpl.readdirSync(logsDir)) {
        const match = FILENAME_RE.exec(name);
        if (!match) continue;
        if (match[1] < cutoffDay) {
          try { fsImpl.rmSync(path.join(logsDir, name), { force: true }); } catch { /* keep going */ }
          continue;
        }
        let size = 0;
        try { size = fsImpl.statSync(path.join(logsDir, name)).size; } catch { size = 0; }
        files.push({ name, day: match[1], size });
      }
      let total = files.reduce((sum, f) => sum + f.size, 0);
      const budget = resolveBudget(maxTotalBytes, 20 * 1024 * 1024);
      for (const f of files.sort((a, b) => (a.day < b.day ? -1 : 1))) {
        if (total <= budget) break;
        try {
          fsImpl.rmSync(path.join(logsDir, f.name), { force: true });
          total -= f.size;
        } catch {
          break;
        }
      }
    } catch {
      // Cleanup is best-effort; the journal keeps working without it.
    }
  }

  function ensureInitialized() {
    if (initialized) return;
    initialized = true;
    try {
      ensureDir();
      const day = isoDay(now());
      currentDay = day;
      currentFilePath = filePathFor(day);
      try {
        currentFileSize = fsImpl.statSync(currentFilePath).size;
      } catch {
        currentFileSize = 0;
      }
    } catch {
      degraded = true;
    }
    cleanupExpired();
  }

  function rotateIfNeeded() {
    const day = isoDay(now());
    if (day === currentDay) return;
    currentDay = day;
    currentFilePath = filePathFor(day);
    saturated = false;
    try {
      currentFileSize = fsImpl.statSync(currentFilePath).size;
    } catch {
      currentFileSize = 0;
    }
    cleanupExpired();
  }

  function truncateString(value, maxLength) {
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength) + '…[truncated]';
  }

  function sanitizeData(data) {
    const cleaned = sanitizer.sanitizeForLog(data);
    if (typeof cleaned === 'string') return truncateString(cleaned, DATA_MAX_JSON_LENGTH);
    if (cleaned === null || cleaned === undefined) return undefined;
    try {
      const json = JSON.stringify(cleaned);
      if (typeof json === 'string' && json.length > DATA_MAX_JSON_LENGTH) {
        return { truncated: true, preview: truncateString(json, DATA_MAX_JSON_LENGTH) };
      }
    } catch {
      return { unserializable: true };
    }
    return cleaned;
  }

  /** Normalize + sanitize one raw entry into its journal shape. */
  function normalizeEntry(raw, defaultSource) {
    const entrySource = raw && (raw.source === 'frontend' || raw.source === 'plugins') ? raw.source : defaultSource;
    const level = raw && LEVELS.has(raw.level) ? raw.level : 'info';
    const entry = {
      id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId(),
      timestamp: typeof raw?.timestamp === 'string' && raw.timestamp ? raw.timestamp : now().toISOString(),
      level,
      source: entrySource,
      module: truncateString(typeof raw?.module === 'string' && raw.module ? raw.module : 'electron.unknown', MODULE_MAX_LENGTH),
      message: truncateString(typeof raw?.message === 'string' ? raw.message : String(raw?.message ?? ''), MESSAGE_MAX_LENGTH),
      sessionId,
    };
    const message = sanitizer.sanitizeForLog(entry.message);
    entry.message = typeof message === 'string' ? truncateString(message, MESSAGE_MAX_LENGTH) : entry.message;
    if (raw && raw.data !== undefined && raw.data !== null) {
      const data = sanitizeData(raw.data);
      if (data !== undefined) entry.data = data;
    }
    const repeatCount = Number(raw?.repeatCount);
    if (Number.isFinite(repeatCount) && repeatCount > 1) entry.repeatCount = Math.min(Math.trunc(repeatCount), 10_000);
    return entry;
  }

  // Writes are synchronous (appendFileSync against the page cache): volumes
  // here are small and bounded by the per-day budget, synchronous appends
  // eliminate tail loss on quit without any before-quit gymnastics, and a
  // failure degrades the whole session to the memory ring instead of
  // throwing into business code paths.
  function writeEntry(entry) {
    if (degraded) {
      pushMemoryRing(entry);
      return;
    }
    try {
      rotateIfNeeded();
      const line = JSON.stringify(entry) + '\n';
      const bytes = Buffer.byteLength(line, 'utf8');
      const budget = resolveBudget(maxFileBytes, 5 * 1024 * 1024);
      if (currentFileSize + bytes > budget) {
        if (!saturated) {
          saturated = true;
          // Record the saturation itself before stopping writes for today
          // (overruns the budget by at most this one marker line).
          const marker = normalizeEntry({
            level: 'warn',
            module: 'electron.diagLogger',
            message: `Daily diagnostics budget reached (${Math.round(budget / 1024 / 1024)}MB); further entries buffer in memory until tomorrow`,
          });
          const markerLine = JSON.stringify(marker) + '\n';
          currentFileSize += Buffer.byteLength(markerLine, 'utf8');
          fsImpl.appendFileSync(currentFilePath, markerLine, 'utf8');
        }
        pushMemoryRing(entry);
        return;
      }
      currentFileSize += bytes;
      fsImpl.appendFileSync(currentFilePath, line, 'utf8');
    } catch {
      degraded = true;
      pushMemoryRing(entry);
    }
  }

  function flushAggregation(key) {
    const active = aggregations.get(key);
    if (!active) return;
    aggregations.delete(key);
    if (active.timer) clearTimeout(active.timer);
    const entry = { ...active.entry, timestamp: now().toISOString() };
    if (active.count > 1) entry.repeatCount = active.count;
    writeEntry(entry);
  }

  /**
   * Record a main-process entry. Non-error levels collapse repeats per
   * 10s window (first occurrence is held until the window closes so the
   * written line can carry the final repeatCount); errors go straight to
   * disk as crash evidence.
   */
  function record(raw) {
    ensureInitialized();
    try {
      const level = LEVELS.has(raw?.level) ? raw.level : 'info';
      if (!aggregateOwnEntries || level === 'error' || raw?.repeatCount > 1) {
        writeEntry(normalizeEntry(raw, source));
        return;
      }
      const probe = normalizeEntry(raw, source);
      const key = `${probe.module}\n${probe.level}\n${probe.message}`;
      const existing = aggregations.get(key);
      const current = now().getTime();
      if (existing && current < existing.flushAt) {
        existing.count += 1;
        return;
      }
      if (existing) flushAggregation(key);
      const timer = setTimeout(() => flushAggregation(key), REPEAT_WINDOW_MS + 5);
      if (typeof timer.unref === 'function') timer.unref();
      aggregations.set(key, {
        entry: probe,
        count: 1,
        flushAt: current + REPEAT_WINDOW_MS,
        timer,
      });
    } catch {
      // Recording must never break the caller.
    }
  }

  /**
   * Ingest a validated renderer batch. Renderer entries are already
   * sanitized and flood-aggregated on the bridge side; no second-stage
   * aggregation is applied to source=frontend entries.
   */
  function ingestRenderer(entries) {
    ensureInitialized();
    try {
      if (!Array.isArray(entries)) return { success: false, error: 'entries must be an array' };
      const batch = entries.slice(0, MAX_INGEST_BATCH);
      for (const raw of batch) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        writeEntry(normalizeEntry({ ...raw, source: 'frontend' }, 'frontend'));
      }
      return { success: true, accepted: Math.min(batch.length, MAX_INGEST_BATCH) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function entryMatchesFilters(entry, { since, level, sources }) {
    if (since && entry.timestamp < since) return false;
    if (level && LEVELS.has(level)) {
      const order = ['debug', 'info', 'warn', 'error'];
      if (order.indexOf(entry.level) < order.indexOf(level)) return false;
    }
    if (sources && !sources.includes(entry.source)) return false;
    return true;
  }

  function parseJournalFile(filePath) {
    let content;
    try {
      content = fsImpl.readFileSync(filePath, 'utf8');
    } catch {
      return [];
    }
    const parsed = [];
    for (const line of content.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry === 'object' && typeof entry.timestamp === 'string') parsed.push(entry);
      } catch {
        // A torn/partial trailing line is expected after crashes; skip it.
      }
    }
    return parsed;
  }

  /** Read the newest journal entries matching the filters (chronological). */
  async function readTail({ since, level, sources, limit = 2000 } = {}) {
    ensureInitialized();
    const wanted = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 5000) : 2000;
    const baseTime = now().getTime();
    // Subtracting exactly 24h per step always lands on distinct local calendar
    // days (DST shifts are ±1h), so each candidate file is visited once.
    const diskEntries = [];
    for (let i = 0; i < maxFiles && diskEntries.length < wanted; i++) {
      const day = isoDay(new Date(baseTime - i * 86_400_000));
      const filePath = filePathFor(day);
      let exists = true;
      try {
        fsImpl.accessSync(filePath);
      } catch {
        exists = false;
      }
      if (exists) {
        const entries = parseJournalFile(filePath);
        for (let j = entries.length - 1; j >= 0 && diskEntries.length < wanted; j--) {
          const entry = entries[j];
          if (entryMatchesFilters(entry, { since, level, sources })) diskEntries.push(entry);
        }
      }
    }
    // Newest-first collection → reverse to chronological so equal
    // timestamps keep their original order under the stable sort below.
    diskEntries.reverse();
    // Merge the memory ring BEFORE applying the cap: when the daily file
    // saturates, the newest records live in the ring and must not be crowded
    // out by older on-disk entries.
    const merged = [...diskEntries];
    for (const entry of memoryRing) {
      if (entryMatchesFilters(entry, { since, level, sources })) merged.push(entry);
    }
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged.slice(-wanted);
  }

  /**
   * Drain pending aggregation windows synchronously; with synchronous writes
   * this completes the journal instantly (used on will-quit — nothing is
   * left in flight, so the quit path needs no async waiting).
   */
  function flushSync() {
    for (const key of Array.from(aggregations.keys())) flushAggregation(key);
  }

  /** Drain pending aggregation windows and wait for the write queue. */
  async function flush() {
    flushSync();
  }

  function stats() {
    return {
      sessionId,
      degraded,
      saturated,
      memoryRing: memoryRing.length,
      pendingAggregations: aggregations.size,
      currentDay,
      currentFileSize,
    };
  }

  return { record, ingestRenderer, readTail, flush, flushSync, stats, sessionId };
}

module.exports = { createDiagLogger, REPEAT_WINDOW_MS, MAX_INGEST_BATCH };
