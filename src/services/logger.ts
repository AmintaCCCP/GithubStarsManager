/**
 * Frontend Logger — ring-buffer in-memory, write-time sanitization, console forwarding.
 */

import { sanitizeForLog, sanitizeError } from '../utils/logSanitizer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
  source: 'frontend';
  /**
   * Flood-aggregation count (set by diagnosticsBridge for repeated
   * module+level+message entries; additive field, never required).
   */
  repeatCount?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isErrorValue(value: unknown): boolean {
  return value instanceof Error
    || (typeof DOMException !== 'undefined' && value instanceof DOMException);
}

/**
 * Error values need a pre-pass before sanitizeForLog: `message` / `stack` are
 * non-enumerable, so the object walk cannot see them and a bare Error would
 * be logged as `{}`. Errors are replaced — at the top level, inside plain
 * objects at any depth, and inside arrays — with sanitizeError's
 * { name, message, stack } record (inline-redacted, stack capped). Structures
 * without any Error are returned by reference, so the existing field-name
 * masking behavior is unchanged; the `seen` WeakSet guards cycles the same
 * way sanitizeForLog does (a revisited node is left as-is for that walk to
 * redact).
 */
function prepareErrorValues(data: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (isErrorValue(data)) return sanitizeError(data);
  if (typeof data !== 'object' || data === null) return data;
  if (seen.has(data)) return data;
  seen.add(data);
  let changed = false;
  const convert = (value: unknown): unknown => {
    const next = prepareErrorValues(value, seen);
    if (next !== value) changed = true;
    return next;
  };
  const converted: unknown = Array.isArray(data)
    ? data.map(convert)
    : Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, convert(value)]));
  seen.delete(data);
  return changed ? converted : data;
}

class Logger {
  private buffer: LogEntry[] = [];
  private maxEntries = 2000;
  private minLevel: LogLevel = 'info';

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    // Sanitize at write time — buffer never contains secrets
    const sanitizedMessage = typeof message === 'string' ? sanitizeForLog(message) as string : String(message);
    const sanitizedData = data !== undefined ? sanitizeForLog(prepareErrorValues(data)) : undefined;

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      module,
      message: sanitizedMessage,
      data: sanitizedData,
      source: 'frontend',
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }

    // Forward to console for dev experience
    this.forwardToConsole(entry);

    // Notify UI listeners
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gsm:diagnostic-log-added', { detail: entry }));
    }
  }

  debug(module: string, message: string, data?: unknown): void {
    this.log('debug', module, message, data);
  }

  info(module: string, message: string, data?: unknown): void {
    this.log('info', module, message, data);
  }

  warn(module: string, message: string, data?: unknown): void {
    this.log('warn', module, message, data);
  }

  error(module: string, message: string, data?: unknown): void {
    this.log('error', module, message, data);
  }

  /**
   * Convenience: log an error with sanitized Error object.
   */
  errorFromError(module: string, message: string, err: unknown, extra?: unknown): void {
    const sanitizedExtra = extra !== undefined && typeof extra === 'object' && extra !== null && !Array.isArray(extra)
      ? sanitizeForLog(extra) as Record<string, unknown>
      : extra !== undefined
        ? { extra: sanitizeForLog(extra) }
        : {};
    this.log('error', module, message, { ...sanitizeError(err), ...sanitizedExtra });
  }

  private forwardToConsole(entry: LogEntry): void {
    const prefix = `[${entry.module}]`;
    const dataStr = entry.data !== undefined ? entry.data : '';
    switch (entry.level) {
      case 'debug':
        console.debug(prefix, entry.message, dataStr);
        break;
      case 'info':
        console.info(prefix, entry.message, dataStr);
        break;
      case 'warn':
        console.warn(prefix, entry.message, dataStr);
        break;
      case 'error':
        console.error(prefix, entry.message, dataStr);
        break;
    }
  }

  getEntries(filter?: { level?: LogLevel; since?: string; module?: string }): LogEntry[] {
    let entries = this.buffer;
    if (filter?.level) {
      const minOrder = LEVEL_ORDER[filter.level];
      entries = entries.filter(e => LEVEL_ORDER[e.level] >= minOrder);
    }
    if (filter?.since) {
      entries = entries.filter(e => e.timestamp >= filter.since!);
    }
    if (filter?.module) {
      entries = entries.filter(e => e.module.startsWith(filter.module!));
    }
    return entries;
  }

  getCounts(): { total: number; debug: number; info: number; warn: number; error: number } {
    const counts = { total: this.buffer.length, debug: 0, info: 0, warn: 0, error: 0 };
    for (const entry of this.buffer) {
      counts[entry.level]++;
    }
    return counts;
  }

  clear(): void {
    this.buffer = [];
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gsm:diagnostic-logs-cleared'));
    }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  isDebugMode(): boolean {
    return this.minLevel === 'debug';
  }

  getModules(): string[] {
    const modules = new Set<string>();
    for (const entry of this.buffer) {
      modules.add(entry.module);
    }
    return Array.from(modules).sort();
  }

  /**
   * Build the export JSON structure (frontend logs only).
   * The UI component merges this with backend logs.
   */
  exportEntries(filter?: { level?: LogLevel; since?: string }): LogEntry[] {
    return this.getEntries(filter);
  }
}

export const logger = new Logger();