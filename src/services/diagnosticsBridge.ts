/**
 * diagnosticsBridge — persists renderer diagnostics into the main-process
 * journal WITHOUT touching the Logger class. It listens to the existing DOM
 * CustomEvents (`gsm:diagnostic-log-added` / `gsm:diagnostic-logs-cleared`),
 * backfills whatever Logger already buffered at install time, and forwards
 * entries to Electron over batched IPC.
 *
 * Responsibilities (all performed renderer-side; the main process ingests
 * frontend batches verbatim to avoid double flood-aggregation):
 *   - persistence level: normal mode keeps warn/error, debug mode keeps all
 *     (mirrors Logger.minLevel semantics, read live from sessionStorage);
 *   - flood aggregation: identical module+level+message within a 2s window
 *     collapses into one entry carrying repeatCount;
 *   - rate limiting: beyond 100 entries/second non-error entries are dropped
 *     for that second (error always passes);
 *   - batching: flush every 2s or 32 entries via ipcRenderer.invoke;
 *   - crash safety: pagehide / beforeunload fire a one-way ipcRenderer.send
 *     flush so the tail of the buffer survives refresh and crashes.
 *
 * In web mode (no window.electronAPI.diagnostics) the bridge is a no-op
 * memory sink — behavior identical to today.
 */

import { logger, type LogEntry } from './logger';
import { setNetworkEntrySink } from './fetchCapture';

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 32;
/** Hard cap per IPC batch (main process rejects > 200). */
const IPC_BATCH_LIMIT = 200;
const AGGREGATION_WINDOW_MS = 2000;
const RATE_LIMIT_PER_SECOND = 100;
/** Upper bound on entries sent during a single unload flush. */
const UNLOAD_FLUSH_LIMIT = 1000;

let installed = false;
let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let rateWindowStart = 0;
let rateWindowUsed = 0;
let suppressedByRateLimit = 0;

function isDebugMode(): boolean {
  try {
    return sessionStorage.getItem('gsm:frontend-debug') === 'true';
  } catch {
    return false;
  }
}

function diagnosticsApi(): Window['electronAPI'] | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI?.diagnostics ? window.electronAPI : null;
}

function shouldPersist(entry: LogEntry, debug: boolean): boolean {
  if (debug) return true;
  return entry.level === 'warn' || entry.level === 'error';
}

function aggregationKey(entry: LogEntry): string {
  return `${entry.module}\n${entry.level}\n${entry.message}`;
}

/**
 * Enqueue one entry for persistence. Applies the level gate, the rate limit,
 * and repeat aggregation; scheduling the flush is left to the caller.
 */
function ingest(entry: LogEntry): void {
  if (!entry || typeof entry !== 'object') return;
  // Web mode (no electron bridge): the journal pipeline does not exist, so
  // nothing is buffered — behavior identical to the pre-bridge app.
  if (!diagnosticsApi()) return;
  const debug = isDebugMode();
  if (!shouldPersist(entry, debug)) return;

  const now = Date.now();
  if (now - rateWindowStart >= 1000) {
    rateWindowStart = now;
    rateWindowUsed = 0;
  }
  rateWindowUsed += 1;
  if (rateWindowUsed > RATE_LIMIT_PER_SECOND) {
    if (entry.level !== 'error') {
      suppressedByRateLimit += 1;
      return;
    }
  }

  // Repeat aggregation: collapse identical module+level+message inside the
  // window, keeping the first entry's data payload and bumping repeatCount.
  for (let i = pending.length - 1; i >= 0 && i >= pending.length - 32; i--) {
    const candidate = pending[i];
    if (candidate.timestamp && now - new Date(candidate.timestamp).getTime() > AGGREGATION_WINDOW_MS) break;
    if (aggregationKey(candidate) === aggregationKey(entry)) {
      candidate.repeatCount = ((candidate.repeatCount as number | undefined) ?? 1) + 1;
      return;
    }
  }
  // Shallow copy: aggregation mutates repeatCount on OUR copy only — the
  // original object is shared with the Logger ring buffer and panel state.
  pending.push({ ...entry });
}

/** Surface rate-limit suppression once per batch so gaps stay explainable. */
function attachSuppressionMarker(): void {
  if (suppressedByRateLimit <= 0) return;
  const suppressed = suppressedByRateLimit;
  suppressedByRateLimit = 0;
  pending.push({
    id: `${Date.now()}-rate`,
    timestamp: new Date().toISOString(),
    level: 'warn',
    module: 'diagnosticsBridge',
    message: `Rate limit: dropped ${suppressed} non-error entries in the last second`,
    source: 'frontend',
  });
}

function scheduleFlush(): void {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/** Batched invoke; silently drops the batch when the main process is gone. */
async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const api = diagnosticsApi();
  if (!api) {
    pending = [];
    suppressedByRateLimit = 0;
    return;
  }
  attachSuppressionMarker();
  while (pending.length > 0) {
    const batch = pending.splice(0, IPC_BATCH_LIMIT);
    try {
      await api.diagnostics!.append({ debugMode: isDebugMode(), entries: batch });
    } catch {
      // Main process not ready or IPC failed — diagnostics must never
      // surface as user-visible errors; drop the batch.
    }
    if (pending.length > 0) scheduleFlush();
  }
}

/** One-way send flush used on pagehide/beforeunload (no await, no invoke). */
function flushNow(): void {
  const api = diagnosticsApi();
  if (!api) {
    pending = [];
    suppressedByRateLimit = 0;
    return;
  }
  attachSuppressionMarker();
  let sent = 0;
  while (pending.length > 0 && sent < UNLOAD_FLUSH_LIMIT) {
    const batch = pending.splice(0, IPC_BATCH_LIMIT);
    sent += batch.length;
    try {
      api.diagnostics!.flush({ debugMode: isDebugMode(), entries: batch });
    } catch {
      // Nothing left to do while unloading; drop silently.
    }
  }
  pending = [];
}

function handleLogAdded(event: Event): void {
  const entry = (event as CustomEvent<LogEntry>).detail;
  if (!entry) return;
  ingest(entry);
  if (pending.length >= FLUSH_THRESHOLD) void flush();
  else scheduleFlush();
}

function handleLogsCleared(): void {
  // The journal stays append-only; clearing only drops what has not been
  // persisted yet so the export view matches the panel view.
  pending = [];
}

/**
 * Install the bridge (idempotent). Backfills the Logger's current buffer so
 * startup-time logs (including early errors) reach the journal, then starts
 * incremental collection. Web mode: installs listeners but never buffers.
 */
export function installDiagnosticsBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Backfill startup-period entries already in the Logger ring buffer.
  for (const entry of logger.getEntries()) ingest(entry);

  window.addEventListener('gsm:diagnostic-log-added', handleLogAdded);
  window.addEventListener('gsm:diagnostic-logs-cleared', handleLogsCleared);
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);

  // Network ledger entries ride the same pipeline into the journal.
  setNetworkEntrySink((entry) => {
    ingest(entry);
    if (pending.length >= FLUSH_THRESHOLD) void flush();
    else scheduleFlush();
  });

  // Startup backfill goes out immediately (flush() falls back to scheduling
  // when nothing is pending, so this stays harmless in web mode).
  void flush();
}

/** Test hooks */
export function getPendingCountForTest(): number {
  return pending.length;
}

export function resetDiagnosticsBridgeForTest(): void {
  pending = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  installed = false;
  rateWindowStart = 0;
  rateWindowUsed = 0;
  suppressedByRateLimit = 0;
  if (typeof window !== 'undefined') {
    window.removeEventListener('gsm:diagnostic-log-added', handleLogAdded);
    window.removeEventListener('gsm:diagnostic-logs-cleared', handleLogsCleared);
    window.removeEventListener('pagehide', flushNow);
    window.removeEventListener('beforeunload', flushNow);
  }
  setNetworkEntrySink(null);
}
